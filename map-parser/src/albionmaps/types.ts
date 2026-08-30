// Raw shapes from the Albion Maps website (albionmaps.com.br) and the
// normalized internal baseline. Nothing outside this directory may import
// Albion Maps structures — syncMaps.ts consumes only `ZoneBaseline`.

/** One entry of a card's `data-tags-payload` JSON array. */
export interface AlbionMapsTag {
  tagId: number;
  tagName: string;
  category: 'single' | 'multiple';
  quantity: number;
  [key: string]: unknown; // pillColor, iconUrl, ... — presentation only
}

/** A map card parsed out of the site's server-rendered search page. */
export interface RawMapCard {
  title: string;
  tags: string;
  tagsPayload: AlbionMapsTag[];
}

/** Roads zone sub-type as tagged by Albion Maps. */
export type RoadsZoneType = 'HO' | 'TUNNEL' | 'GROUP_PORTAL' | 'BLACK';

/**
 * Normalized static metadata for one zone, after zone matching has attached
 * the catalogue identity (zoneId/zoneName). This is the boundary type the
 * rest of the application sees; it carries no Albion Maps vocabulary.
 */
export interface ZoneBaseline {
  zoneId: string;
  zoneName: string;
  tier: number | null;
  zoneType: RoadsZoneType | null;
  chests: {
    largeGold: number;
    smallGold: number;
    blue: number;
    green: number;
  };
  dungeon: number; // DG tag count
  resources: {
    hide: boolean;
    ore: boolean;
    fiber: boolean;
    wood: boolean;
    stone: boolean;
  };
  /** Tag names the site uses that we do not understand — reported, never silent. */
  unknownTags: string[];
}

/** A baseline before the catalogue identity is attached. */
export type BaselineSource = Omit<ZoneBaseline, 'zoneId' | 'zoneName'>;
