import { readFileSync } from 'node:fs';
import { fetchCards } from './client.js';
import { matchZone } from './match.js';
import { normalizeCard } from './normalize.js';
import type { RawMapCard, ZoneBaseline } from './types.js';
import type { GameMap } from '../types.js';

export interface AlbionMapsOptions {
  /** False disables the stage entirely (offline runs, CI without network). */
  enabled: boolean;
  /**
   * Optional JSON cache of per-zone site responses keyed by catalogue name:
   * `{ "Quaent-Vynsum": RawMapCard[] }`. When present, no network is used —
   * this is how tests and offline runs exercise the stage.
   */
  cachePath?: string;
  /** Pacing between live requests (ms). Keeps a ~400-zone sync polite. */
  delayMs?: number;
  /** Warning sink; the sync wires this to its warn/--strict machinery. */
  warn: (message: string) => void;
}

export interface AlbionMapsReport {
  roadsZones: number;
  matched: number;
  unmatched: string[];
  unknownTags: Set<string>;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// Baseline resource keys → catalogue `knownFeatures` resource strings.
const RESOURCE_TO_FEATURE: Record<keyof ZoneBaseline['resources'], string> = {
  hide: 'hide',
  ore: 'ore',
  fiber: 'cotton',
  wood: 'logs',
  stone: 'rock',
};

// Baseline chest keys with a count > 0 → catalogue `knownFeatures` chest strings.
const CHEST_TO_FEATURE: Array<[keyof ZoneBaseline['chests'], string]> = [
  ['green', 'largeGreenChest'],
  ['blue', 'largeBlueChest'],
  ['largeGold', 'largeGoldChest'],
];

/**
 * Apply an Albion Maps baseline to a catalogue entry. Albion Maps is the
 * authoritative source for the static fields it carries: tier, hideout flag,
 * group portal, chest/resource/dungeon counts. `knownFeatures` is regenerated
 * from the baseline so there is exactly one derivation path.
 */
export function applyBaseline(map: GameMap, baseline: ZoneBaseline): void {
  if (baseline.tier !== null) {
    map.tier = baseline.tier;
  }
  if (baseline.zoneType === 'HO') {
    map.isRoadsHideout = true;
  } else if (baseline.zoneType !== null) {
    delete map.isRoadsHideout;
  }
  if (baseline.zoneType === 'GROUP_PORTAL') {
    map.groupPortal = true;
  } else {
    delete map.groupPortal;
  }

  map.baselineFeatures = {
    chests: { ...baseline.chests },
    dungeon: baseline.dungeon,
    resources: { ...baseline.resources },
  };

  const features: string[] = [];
  for (const [key, feat] of Object.entries(RESOURCE_TO_FEATURE) as Array<
    [keyof ZoneBaseline['resources'], string]
  >) {
    if (baseline.resources[key]) features.push(feat);
  }
  for (const [key, feat] of CHEST_TO_FEATURE) {
    if (baseline.chests[key] > 0) features.push(feat);
  }
  map.knownFeatures = features.sort();
}

/**
 * Enrich every roads zone with Albion Maps static metadata. Deterministic per
 * input: zones are processed in array order, each baseline is computed from
 * the card alone, and the caller sorts the output afterwards.
 *
 * Failure semantics: any fetch/parse error propagates (the sync aborts before
 * writing); unmatched zones are reported through `warn` and keep their
 * feed-derived values as a fallback.
 */
export async function enrichRoadsZones(
  maps: GameMap[],
  opts: AlbionMapsOptions,
): Promise<AlbionMapsReport> {
  const report: AlbionMapsReport = {
    roadsZones: 0,
    matched: 0,
    unmatched: [],
    unknownTags: new Set(),
  };
  if (!opts.enabled) return report;

  const cache: Record<string, RawMapCard[]> = opts.cachePath
    ? (JSON.parse(readFileSync(opts.cachePath, 'utf8')) as Record<string, RawMapCard[]>)
    : {};

  const roads = maps.filter((m) => m.mapType === 'roads');
  report.roadsZones = roads.length;

  for (const zone of roads) {
    const cards: RawMapCard[] = opts.cachePath
      ? (cache[zone.mapName] ?? [])
      : await fetchCards(zone.mapName);

    if (opts.cachePath === undefined) {
      await sleep(opts.delayMs ?? 150);
    }

    const matchedTitle = matchZone(zone.mapName, cards);
    if (matchedTitle === null) {
      report.unmatched.push(zone.mapName);
      opts.warn(`Albion Maps: no card matched for "${zone.mapName}"`);
      continue;
    }

    const card = cards.find((c) => c.title === matchedTitle)!;
    const source = normalizeCard(card);
    for (const tag of source.unknownTags) report.unknownTags.add(tag);

    applyBaseline(zone, {
      zoneId: zone.mapID,
      zoneName: zone.mapName,
      ...source,
    });
    report.matched++;
  }

  return report;
}
