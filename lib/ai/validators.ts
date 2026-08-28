function normalized(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

export function validateEvidenceQuotes(content: string, values: unknown) {
  const source = normalized(content);
  const requested = Array.isArray(values) ? values.map(String).map((value) => value.trim()).filter(Boolean).slice(0, 5) : [];
  const accepted = requested.filter((quote) => quote.length >= 2 && source.includes(normalized(quote)));
  return { requested, accepted, allValid: requested.length > 0 && requested.length === accepted.length };
}

export function clampScore(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
}

export function clampConfidence(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}
