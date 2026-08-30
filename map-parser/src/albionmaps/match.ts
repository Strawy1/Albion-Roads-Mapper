import { AlbionMapsAmbiguousMatchError } from './errors.js';
import type { RawMapCard } from './types.js';

/** Canonical comparison form: lowercase, single spaces, no hyphens. */
export function normalizeZoneName(name: string): string {
  return name.replace(/[-\s]+/g, ' ').trim().toLowerCase();
}

/**
 * Catalogue spelling → site spelling for zones where the two diverge. Seeded
 * empty: every discrepancy found during the initial import gets an entry here
 * (plus a test), so a resync stays deterministic instead of relying on fuzzy
 * matching. Keys and values are normalized forms.
 */
export const ZONE_NAME_ALIASES = new Map<string, string>();

/**
 * Find the site card whose title matches a catalogue zone name.
 *
 * Matching is exact after normalization, then aliases, then nothing — there is
 * deliberately no fuzzy fallback. Returns null when the zone is not on the
 * site (reported as unmatched) and throws when two cards are indistinguishable
 * (a duplicate-zone hazard the project has hit before).
 */
export function matchZone(catalogueName: string, cards: RawMapCard[]): string | null {
  const target = ZONE_NAME_ALIASES.get(normalizeZoneName(catalogueName))
    ?? normalizeZoneName(catalogueName);

  const matches = cards.filter((c) => normalizeZoneName(c.title) === target);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new AlbionMapsAmbiguousMatchError(
      `Ambiguous match for "${catalogueName}": ${matches.map((c) => c.title).join(', ')}`,
    );
  }
  return matches[0].title;
}
