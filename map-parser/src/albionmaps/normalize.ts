import type { AlbionMapsTag, BaselineSource, RawMapCard, RoadsZoneType } from './types.js';

// Tag vocabulary as published by the site's own settings panel. Unknown tag
// names are collected into `unknownTags` and reported by the sync — never
// silently dropped and never guessed.
const TIER_TAGS: Record<string, number> = { T4: 4, T6: 6, T8: 8 };

const ZONE_TYPE_TAGS: Record<string, RoadsZoneType> = {
  HO: 'HO',
  TUNNEL: 'TUNNEL',
  'GROUP PORTAL': 'GROUP_PORTAL',
  // The site tags black-zone roads (e.g. "Setos - Aiaitum") with BLACK; for the
  // mapper these are ordinary non-hideout roads zones, so the type is carried
  // through the baseline but changes nothing else.
  BLACK: 'BLACK',
};

const CHEST_TAGS: Record<string, keyof BaselineSource['chests']> = {
  'L GOLD': 'largeGold',
  'S GOLD': 'smallGold',
  BLUE: 'blue',
  GREEN: 'green',
};

const RESOURCE_TAGS: Record<string, keyof BaselineSource['resources']> = {
  Hide: 'hide',
  Ore: 'ore',
  Fiber: 'fiber',
  Wood: 'wood',
  Stone: 'stone',
};

/** Site quantities are counts; anything missing/NaN/negative becomes zero. */
function quantityOf(tag: AlbionMapsTag): number {
  const q = Number(tag.quantity);
  return Number.isFinite(q) && q > 0 ? Math.trunc(q) : 0;
}

/**
 * Convert a raw site card into the internal baseline. Deterministic: the same
 * payload always produces the same baseline, tag order notwithstanding.
 */
export function normalizeCard(card: RawMapCard): BaselineSource {
  const baseline: BaselineSource = {
    tier: null,
    zoneType: null,
    chests: { largeGold: 0, smallGold: 0, blue: 0, green: 0 },
    dungeon: 0,
    resources: { hide: false, ore: false, fiber: false, wood: false, stone: false },
    unknownTags: [],
  };

  for (const tag of card.tagsPayload ?? []) {
    const name = tag.tagName;
    if (name === undefined || name === null) continue;
    if (name in TIER_TAGS) {
      baseline.tier = TIER_TAGS[name];
    } else if (name in ZONE_TYPE_TAGS) {
      baseline.zoneType = ZONE_TYPE_TAGS[name];
    } else if (name === 'DG') {
      baseline.dungeon = quantityOf(tag);
    } else if (name in CHEST_TAGS) {
      baseline.chests[CHEST_TAGS[name]] = quantityOf(tag);
    } else if (name in RESOURCE_TAGS) {
      baseline.resources[RESOURCE_TAGS[name]] = true;
    } else {
      baseline.unknownTags.push(name);
    }
  }

  return baseline;
}
