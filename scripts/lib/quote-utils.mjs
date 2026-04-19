export function normalizeSupabaseRpcPayload(payload) {
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row !== "object") {
    throw new Error("Quote payload is empty.");
  }

  return {
    date: ensureString(row.date, "date"),
    ja_translation: ensureString(row.ja_translation, "ja_translation"),
    en_translation: ensureString(row.en_translation, "en_translation"),
    original_text: ensureString(row.original_text, "original_text"),
    speaker_name: ensureString(row.speaker_name, "speaker_name"),
    birth_year: toNullableInteger(row.birth_year),
    death_year: toNullableInteger(row.death_year),
    source: typeof row.source === "string" ? row.source : "",
  };
}

function ensureString(value, key) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Quote payload has invalid ${key}.`);
  }
  return value;
}

function toNullableInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error("Quote payload has invalid year value.");
  }
  return parsed;
}
