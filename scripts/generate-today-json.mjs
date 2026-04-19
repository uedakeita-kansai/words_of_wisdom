import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSupabaseRpcPayload } from "./lib/quote-utils.mjs";

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

const outputPath = path.resolve(projectRoot, args.get("--output") || "today.json");
const inputFile = args.get("--input-file");

async function readPayload() {
  if (inputFile) {
    const raw = await readFile(path.resolve(projectRoot, inputFile), "utf8");
    return JSON.parse(raw);
  }
  return fetchFromSupabase();
}

async function fetchFromSupabase() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const apiKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !apiKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) are required."
    );
  }

  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/get_today_quote`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: apiKey,
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: "{}",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase RPC failed (${response.status}): ${body}`);
  }

  return response.json();
}

async function main() {
  const payload = await readPayload();
  const quote = normalizeSupabaseRpcPayload(payload);
  const output = `${JSON.stringify(quote, null, 2)}\n`;
  await writeFile(outputPath, output, "utf8");
  console.log(`Generated ${path.relative(projectRoot, outputPath)} (${quote.date})`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
