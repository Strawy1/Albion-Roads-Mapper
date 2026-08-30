import { NodeFeatures } from 'shared';

/**
 * Initial features for a newly created node. Deliberately EMPTY: static zone
 * metadata (tier, zone type, chests, resources, dungeons) is imported from
 * Albion Maps into the catalogue (`Zone.baselineFeatures`) and rendered
 * read-only by the client. It is not copied into per-room editable state, so
 * it can never be accidentally overwritten. Everything a user records live
 * (reds, power cores, timed chests, crystal creature) starts unset and is
 * added by the UI.
 */
export function getInitialFeatures(_zoneId: string): NodeFeatures {
  return {};
}
