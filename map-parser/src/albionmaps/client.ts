import { AlbionMapsFetchError, AlbionMapsParseError } from './errors.js';
import type { AlbionMapsTag, RawMapCard } from './types.js';

export const ALBION_MAPS_BASE = 'https://www.albionmaps.com.br';

const USER_AGENT = 'albionroads-map-parser/1.0 (static metadata sync, contact: repo)';

/**
 * Build the site's search URL for a zone. The site token-matches on spaces and
 * breaks on hyphens, so "Suyites-Uzurtum" must be sent as "Suyites Uzurtum".
 */
export function searchUrl(name: string): string {
  const query = name.replace(/[-\s]+/g, ' ').trim();
  return `${ALBION_MAPS_BASE}/?lang=en&title=${encodeURIComponent(query)}`;
}

// Matches every card's `data-tags-payload` attribute. The payload is
// URL-encoded JSON (quotes are %22), so `[^"]*` is safe. Attribute order is
// deliberately ignored: the title/tags are scanned backwards from the payload.
const PAYLOAD_RE = /data-tags-payload="([^"]*)"/g;
const BACKSCAN_WINDOW = 2000;

/**
 * Parse map cards out of a server-rendered Albion Maps search page. Pure —
 * no network — so it is unit-testable against captured fixtures.
 *
 * Each card is rendered twice on the page (save-button and thumbnail both
 * carry the full attribute set), so results are deduplicated by title — a
 * page can never contain two distinct zones with the same name.
 */
export function parseCardsFromHtml(html: string): RawMapCard[] {
  const cards: RawMapCard[] = [];
  const seenTitles = new Set<string>();
  for (const m of html.matchAll(PAYLOAD_RE)) {
    const payloadEnc = m[1];
    const before = html.slice(Math.max(0, m.index - BACKSCAN_WINDOW), m.index);
    const title = before.match(/data-title="([^"]*)"/)?.[1] ?? '';
    if (title === '' || seenTitles.has(title)) continue;
    seenTitles.add(title);
    const tags = before.match(/data-tags="([^"]*)"/)?.[1] ?? '';

    let tagsPayload: AlbionMapsTag[];
    try {
      const decoded = decodeURIComponent(payloadEnc);
      const parsed = JSON.parse(decoded) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('payload is not a JSON array');
      }
      tagsPayload = parsed as AlbionMapsTag[];
    } catch (cause) {
      throw new AlbionMapsParseError(
        `Malformed data-tags-payload on card "${title}": ${String(cause)}`,
        { cause },
      );
    }

    cards.push({ title, tags, tagsPayload });
  }
  return cards;
}

/**
 * Fetch the cards matching a zone name from the live site. One request per
 * zone; callers are responsible for pacing. Throws AlbionMapsFetchError on
 * network/HTTP failure and AlbionMapsParseError on unparseable HTML.
 */
export async function fetchCards(name: string): Promise<RawMapCard[]> {
  const url = searchUrl(name);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (cause) {
    throw new AlbionMapsFetchError(`Failed to fetch ${url}: ${String(cause)}`, { cause });
  }
  if (!res.ok) {
    throw new AlbionMapsFetchError(`Albion Maps answered ${res.status} for "${name}"`);
  }
  return parseCardsFromHtml(await res.text());
}
