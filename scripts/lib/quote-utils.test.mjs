import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSupabaseRpcPayload } from "./quote-utils.mjs";

test("normalizes RPC array payload", () => {
  const payload = [
    {
      date: "2026-04-19",
      ja_translation: "日本語",
      en_translation: "English",
      original_text: "Original",
      speaker_name: "Speaker",
      birth_year: -470,
      death_year: -399,
      source: "Source",
    },
  ];

  const normalized = normalizeSupabaseRpcPayload(payload);
  assert.equal(normalized.date, "2026-04-19");
  assert.equal(normalized.speaker_name, "Speaker");
  assert.equal(normalized.birth_year, -470);
});

test("normalizes RPC object payload", () => {
  const payload = {
    date: "2026-04-19",
    ja_translation: "日本語",
    en_translation: "English",
    original_text: "Original",
    speaker_name: "Speaker",
    birth_year: null,
    death_year: null,
    source: "",
  };

  const normalized = normalizeSupabaseRpcPayload(payload);
  assert.equal(normalized.source, "");
  assert.equal(normalized.birth_year, null);
});

test("throws when payload is empty", () => {
  assert.throws(() => normalizeSupabaseRpcPayload([]), /empty/);
});
