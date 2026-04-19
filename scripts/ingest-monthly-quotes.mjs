import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const token = process.argv[i];
  if (!token.startsWith("--")) continue;
  const key = token;
  const maybeValue = process.argv[i + 1];
  if (!maybeValue || maybeValue.startsWith("--")) {
    args.set(key, "true");
  } else {
    args.set(key, maybeValue);
    i += 1;
  }
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;
const openaiModel = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const sourceFile = args.get("--input-file") || "data/monthly_quote_candidates.json";
const runSource = args.get("--source") || "monthly_llm_ingestion";
const skipScheduleUpdate = args.get("--skip-schedule-update") === "true";

let currentRunId = null;

async function main() {
  ensureSupabaseEnv();
  const rawCandidates = await loadCandidates(sourceFile);
  const preparedCandidates = await enrichCandidates(rawCandidates);

  currentRunId = await rpc("create_quote_ingestion_run", {
    p_source: runSource,
    p_input_count: preparedCandidates.length,
  });

  const insertedCount = await insertCandidates(currentRunId, preparedCandidates);
  const validation = await rpc("validate_quote_candidates", { p_run_id: currentRunId });
  const promotedCount = await rpc("promote_quote_candidates", { p_run_id: currentRunId });

  if (!skipScheduleUpdate) {
    await rpc("generate_monthly_quote_schedule", {
      p_month: firstDayOfNextMonthInTokyo(),
    });
  }

  const validatedCount = Number(validation?.validated_count || 0);
  const rejectedCount = Number(validation?.rejected_count || 0);
  await rpc("complete_quote_ingestion_run", {
    p_run_id: currentRunId,
    p_status: "completed",
    p_inserted_count: insertedCount,
    p_validated_count: validatedCount,
    p_rejected_count: rejectedCount,
    p_promoted_count: Number(promotedCount || 0),
    p_error_message: null,
  });

  console.log(
    [
      `run_id=${currentRunId}`,
      `input=${preparedCandidates.length}`,
      `inserted=${insertedCount}`,
      `validated=${validatedCount}`,
      `rejected=${rejectedCount}`,
      `promoted=${Number(promotedCount || 0)}`,
      `schedule_updated=${String(!skipScheduleUpdate)}`,
    ].join(" ")
  );
}

main().catch(async (error) => {
  console.error(error.message);
  if (currentRunId) {
    try {
      await rpc("complete_quote_ingestion_run", {
        p_run_id: currentRunId,
        p_status: "failed",
        p_inserted_count: 0,
        p_validated_count: 0,
        p_rejected_count: 0,
        p_promoted_count: 0,
        p_error_message: String(error.message || error),
      });
    } catch (finalizeError) {
      console.error(`Failed to finalize run: ${finalizeError.message}`);
    }
  }
  process.exitCode = 1;
});

function ensureSupabaseEnv() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }
}

async function loadCandidates(relativePath) {
  const absolutePath = path.resolve(projectRoot, relativePath);
  const raw = await readFile(absolutePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Monthly candidate file must be an array.");
  }
  return parsed;
}

async function enrichCandidates(candidates) {
  const output = [];
  for (const candidate of candidates) {
    const normalized = normalizeBaseCandidate(candidate);
    if (!normalized.ja_translation || !normalized.en_translation) {
      const enriched = await tryEnrichWithLLM(normalized);
      output.push(enriched);
    } else {
      output.push(normalized);
    }
  }
  return output;
}

function normalizeBaseCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") {
    throw new Error("Candidate row must be an object.");
  }

  const normalized = {
    original_text: ensureNonEmptyString(candidate.original_text, "original_text"),
    speaker_name: ensureNonEmptyString(candidate.speaker_name, "speaker_name"),
    source: ensureNonEmptyString(candidate.source, "source"),
    source_url: asOptionalString(candidate.source_url),
    ja_translation: asOptionalString(candidate.ja_translation),
    en_translation: asOptionalString(candidate.en_translation),
    birth_year: toNullableInteger(candidate.birth_year),
    death_year: toNullableInteger(candidate.death_year),
    metadata: candidate.metadata && typeof candidate.metadata === "object" ? candidate.metadata : {},
  };

  if (
    normalized.birth_year !== null &&
    normalized.death_year !== null &&
    normalized.birth_year > normalized.death_year
  ) {
    throw new Error(
      `Invalid year range in candidate: ${normalized.speaker_name} (${normalized.birth_year} > ${normalized.death_year})`
    );
  }

  return normalized;
}

async function tryEnrichWithLLM(candidate) {
  if (!openaiApiKey) {
    return candidate;
  }

  const systemPrompt =
    "You normalize quote records. Return strict JSON only with keys ja_translation and en_translation. " +
    "Do not invent facts. Keep meaning faithful to original_text.";
  const userPayload = {
    original_text: candidate.original_text,
    speaker_name: candidate.speaker_name,
    source: candidate.source,
    existing_ja_translation: candidate.ja_translation,
    existing_en_translation: candidate.en_translation,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${openaiApiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: openaiModel,
      response_format: { type: "json_object" },
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenAI response did not include message content.");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("OpenAI response content is not valid JSON.");
  }

  return {
    ...candidate,
    ja_translation: candidate.ja_translation || asOptionalString(parsed.ja_translation),
    en_translation: candidate.en_translation || asOptionalString(parsed.en_translation),
    metadata: {
      ...candidate.metadata,
      llm_enriched_at: new Date().toISOString(),
      llm_model: openaiModel,
    },
  };
}

async function insertCandidates(runId, candidates) {
  if (candidates.length === 0) return 0;
  const payload = candidates.map((candidate) => ({
    ...candidate,
    run_id: runId,
  }));

  await restInsert("quote_candidates", payload);
  return payload.length;
}

async function rpc(name, body) {
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${name}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body || {}),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`RPC ${name} failed (${response.status}): ${raw}`);
  }

  if (!raw) return null;
  const parsed = JSON.parse(raw);
  return unwrapRpcResult(parsed);
}

function unwrapRpcResult(result) {
  if (Array.isArray(result)) {
    if (result.length === 0) return null;
    if (result.length === 1) {
      const row = result[0];
      if (row && typeof row === "object") {
        const keys = Object.keys(row);
        if (keys.length === 1 && keys[0] !== "validated_count" && keys[0] !== "rejected_count") {
          return row[keys[0]];
        }
      }
      return row;
    }
    return result;
  }
  return result;
}

async function restInsert(table, rows) {
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/${table}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Insert into ${table} failed (${response.status}): ${body}`);
  }
}

function ensureNonEmptyString(value, key) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Candidate has invalid ${key}.`);
  }
  return value.trim();
}

function asOptionalString(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNullableInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Year value is not integer: ${value}`);
  }
  return parsed;
}

function firstDayOfNextMonthInTokyo() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
  }).formatToParts(new Date());

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);

  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error("Failed to resolve Tokyo date parts.");
  }

  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01`;
}
