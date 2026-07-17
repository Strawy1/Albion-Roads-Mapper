import { z } from 'zod';
import type { GameMap, KnownFeatures, MapType } from 'shared';

// The domain types are owned by the shared package (web/shared/src/types.ts);
// re-export them so map-parser code has a single source of truth.
export type { GameMap, KnownFeatures, MapType };

export interface GuaranteedContent {
  type: 'LargeGreenChest' | 'LargeBlueChest' | 'LargeGoldChest';
  category: 'chest';
}

export const MapTypeSchema = z.enum([
  'royalBlue',
  'royalYellow',
  'royalRed',
  'outlands',
  'roads',
  'other',
]);

export const KnownFeaturesSchema = z.array(z.string());

// Output validation for generated maps.json entries. Zod strips unknown keys,
// so every GameMap field must be listed here or sync/migrate silently drops it.
export const GameMapSchema: z.ZodType<GameMap> = z.object({
  mapID: z.string(),
  mapName: z.string(),
  mapType: MapTypeSchema,
  tier: z.number().int().min(1).max(8),
  category: z.string().optional(),
  isRoadsHideout: z.literal(true).optional(),
  knownFeatures: KnownFeaturesSchema.optional(),
  mapShape: z.string().optional(),
  socketCount: z.number().int().nonnegative().optional(),
  largeSocketCount: z.number().int().nonnegative().optional(),
  smallSocketCount: z.number().int().nonnegative().optional(),
  proximityTo: z.string().optional(),
});
