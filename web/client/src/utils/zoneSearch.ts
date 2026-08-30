/**
 * Zone search helpers implementing the Albion community's two-letter-prefix
 * convention ("ce av" → "Cetos-Avixnum"), with plain substring matching kept
 * as a fallback so partial-word queries ("vyns") still work.
 */

/** Lowercase alphanumeric words of a zone name ("Quaent - Vynsum" → [quaent, vynsum]). */
export function splitZoneWords(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Query tokens ("ce av" / "qu-vy" / "Qiient Al" all tokenize the same way). */
function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function matchesZoneQuery(name: string, query: string): boolean {
  const q = query.toLowerCase().trim();
  if (q === '') return true;

  const tokens = queryTokens(q);
  const words = splitZoneWords(name);

  // Every token must prefix-match at least one word of the zone name.
  if (tokens.every((t) => words.some((w) => w.startsWith(t)))) {
    return true;
  }

  // Fallback: the raw query as a substring of the name.
  return name.toLowerCase().includes(q);
}

/**
 * Sort score for a matched zone: full prefix-token matches rank above
 * substring-only matches; non-matches score 0 (filter them out first).
 */
export function zoneQueryScore(name: string, query: string): number {
  const q = query.toLowerCase().trim();
  if (q === '') return 0;

  const tokens = queryTokens(q);
  const words = splitZoneWords(name);
  const matched = tokens.filter((t) => words.some((w) => w.startsWith(t))).length;

  if (matched === tokens.length) {
    return 100 + matched; // all tokens prefix-matched a word
  }
  return name.toLowerCase().includes(q) ? 1 : 0;
}
