const page = document.querySelector(".quote-page");
const apiEndpoint = page?.dataset.apiEndpoint || "./today.json";
const cacheKey = "words_of_wisdom:today_quote";

const fields = {
  date: document.querySelector('[data-field="date"]'),
  ja_translation: document.querySelector('[data-field="ja_translation"]'),
  en_translation: document.querySelector('[data-field="en_translation"]'),
  original_text: document.querySelector('[data-field="original_text"]'),
  speaker_name: document.querySelector('[data-field="speaker_name"]'),
  speaker_years: document.querySelector('[data-field="speaker_years"]'),
  source: document.querySelector('[data-field="source"]'),
};

function formatYear(year) {
  if (year === null || year === undefined) return "";
  const y = Number(year);
  if (Number.isNaN(y)) return "";
  if (y < 0) return `${Math.abs(y)} BC`;
  return `${y}`;
}

function formatLifespan(birthYear, deathYear) {
  const birth = formatYear(birthYear);
  const death = formatYear(deathYear);
  if (!birth && !death) return "";
  if (birth && death) return `(${birth} - ${death})`;
  return birth ? `(${birth} - )` : `(- ${death})`;
}

function normalizeQuote(input) {
  if (!input || typeof input !== "object") return null;
  return {
    date: typeof input.date === "string" ? input.date : "",
    ja_translation: typeof input.ja_translation === "string" ? input.ja_translation : "",
    en_translation: typeof input.en_translation === "string" ? input.en_translation : "",
    original_text: typeof input.original_text === "string" ? input.original_text : "",
    speaker_name: typeof input.speaker_name === "string" ? input.speaker_name : "",
    birth_year: input.birth_year ?? null,
    death_year: input.death_year ?? null,
    source: typeof input.source === "string" ? input.source : "",
  };
}

function formatTokyoDate(dateText) {
  const date = dateText ? new Date(`${dateText}T00:00:00+09:00`) : new Date();
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Tokyo",
  }).format(date);
  return `${dateLabel} in Tokyo`;
}

function applyQuoteToView(quote) {
  if (!quote) return;

  if (fields.date) fields.date.textContent = formatTokyoDate(quote.date);
  if (fields.ja_translation) fields.ja_translation.textContent = quote.ja_translation || "";
  if (fields.en_translation) fields.en_translation.textContent = quote.en_translation || "";
  if (fields.original_text) fields.original_text.textContent = quote.original_text || "";
  if (fields.speaker_name) fields.speaker_name.textContent = quote.speaker_name || "";
  if (fields.speaker_years) {
    fields.speaker_years.textContent = formatLifespan(quote.birth_year, quote.death_year);
  }

  if (fields.source) {
    if (quote.source) {
      fields.source.hidden = false;
      fields.source.textContent = `Source: ${quote.source}`;
    } else {
      fields.source.hidden = true;
      fields.source.textContent = "";
    }
  }
}

function readCachedQuote() {
  try {
    const raw = localStorage.getItem(cacheKey);
    if (!raw) return null;
    return normalizeQuote(JSON.parse(raw));
  } catch (error) {
    console.warn("Failed to read cache.", error);
    return null;
  }
}

function writeCachedQuote(quote) {
  try {
    localStorage.setItem(cacheKey, JSON.stringify(quote));
  } catch (error) {
    console.warn("Failed to write cache.", error);
  }
}

async function fetchTodayQuote() {
  const response = await fetch(apiEndpoint, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return normalizeQuote(await response.json());
}

async function init() {
  const cached = readCachedQuote();
  if (cached) {
    applyQuoteToView(cached);
  }

  try {
    const quote = await fetchTodayQuote();
    if (quote) {
      applyQuoteToView(quote);
      writeCachedQuote(quote);
    }
  } catch (error) {
    console.error("Failed to fetch today quote. Keeping current content.", error);
  }
}

init();
