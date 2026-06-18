import type { CustomHandle, ZoneType } from './types.js';
import { getDefaultHandles, getShapeHandlePositions } from './handles.js';

/**
 * Rotation is stored as the number of clockwise 90° steps from the default orientation.
 * 0 = default, 1 = 90° clockwise, 2 = 180°, 3 = 270° clockwise.
 */

export function normalizeRotationSteps(steps: number | null | undefined): number {
  const n = Number.isFinite(steps as number) ? (steps as number) : 0;
  return ((n % 4) + 4) % 4;
}

export function rotationStepsToDegrees(steps: number): number {
  return ((steps % 4) + 4) % 4 * 90;
}

export function rotateClockwise(currentSteps: number): number {
  return ((currentSteps + 1) % 4 + 4) % 4;
}

export function rotateCounterClockwise(currentSteps: number): number {
  return ((currentSteps - 1) % 4 + 4) % 4;
}

/**
 * Converts a handle (x%, y%) position to a perimeter parameter t in [0, 4).
 * The diamond perimeter goes: top(0.5,0) -> right(1,0.5) -> bottom(0.5,1) -> left(0,0.5).
 * t=0 is top, t=1 is right, t=2 is bottom, t=3 is left.
 */
function handleToT(xPercent: number, yPercent: number): number {
  const d0 = Math.abs((xPercent - 50) - yPercent);
  const d1 = Math.abs((xPercent - 100) + (yPercent - 50));
  const d2 = Math.abs((xPercent - 50) - (yPercent - 100));
  const d3 = Math.abs(xPercent + (yPercent - 50));

  const minDist = Math.min(d0, d1, d2, d3);

  if (minDist === d0) return Math.max(0, Math.min(1, (xPercent - 50) / 50));
  if (minDist === d1) return 1 + Math.max(0, Math.min(1, (100 - xPercent) / 50));
  if (minDist === d2) return 2 + Math.max(0, Math.min(1, (50 - xPercent) / 50));
  return 3 + Math.max(0, Math.min(1, xPercent / 50));
}

/**
 * Given a set of actual handle positions and the default (unrotated) handle positions
 * for the same shape, infers the most likely rotation step (0–3) that was applied.
 *
 * Returns null if the handles are empty, counts don't match, or no consistent
 * rotation can be determined (e.g. custom/non-shape handles).
 */
export function inferRotationFromHandles(
  actualHandles: { id: string; left: string; top: string }[],
  defaultHandles: { id: string; left: string; top: string }[],
): number | null {
  if (actualHandles.length === 0 || defaultHandles.length === 0) return null;
  if (actualHandles.length !== defaultHandles.length) return null;

  const rotationVotes: number[] = [];

  for (let i = 0; i < defaultHandles.length; i++) {
    const def = defaultHandles[i];
    const act = actualHandles.find(h => h.id === def.id);
    if (!act) return null;

    const tDefault = handleToT(parseFloat(def.left), parseFloat(def.top));
    const tActual = handleToT(parseFloat(act.left), parseFloat(act.top));

    const diff = tActual - tDefault;
    const steps = Math.round(((diff % 4) + 4) % 4);
    rotationVotes.push(steps);
  }

  // All handles must agree on the same rotation step
  const allAgree = rotationVotes.every(v => v === rotationVotes[0]);
  if (!allAgree) return null;

  return rotationVotes[0];
}

/**
 * Internal: convert handle (left%, top%) → perimeter parameter t in [0, 4).
 */
function handlePosToT(left: string, top: string): number {
  return handleToT(parseFloat(left), parseFloat(top));
}

function tToHandlePos(t: number): { left: string; top: string } {
  const tt = ((t % 4) + 4) % 4;
  let x: number, y: number;
  if (tt < 1) {
    x = 50 + 50 * tt;
    y = 50 * tt;
  } else if (tt < 2) {
    x = 100 - 50 * (tt - 1);
    y = 50 + 50 * (tt - 1);
  } else if (tt < 3) {
    x = 50 - 50 * (tt - 2);
    y = 100 - 50 * (tt - 2);
  } else {
    x = 50 * (tt - 3);
    y = 50 - 50 * (tt - 3);
  }
  return { left: `${x.toFixed(2)}%`, top: `${y.toFixed(2)}%` };
}

/**
 * Returns true if a handle id belongs to the standard shape handle ids
 * (e.g. "c-p1", "f-p4"…) for the given shape. These ids are owned by the shape
 * and must always sit at the rotated default positions.
 */
function isShapeHandleId(id: string, shape: string | undefined): boolean {
  if (!shape) return false;
  return new RegExp(`^${shape}-p\\d+$`).test(id);
}

/**
 * Produces the canonical set of `customHandles` for a zone given a target rotation step.
 *
 * Rules:
 *  - Hideouts and zones without a shape: rotation does not affect handles, so the
 *    incoming handles are returned untouched.
 *  - For shaped zones, all shape handles (e.g. "c-p1"…"c-p6") are rebuilt from the
 *    shape's default handle positions and rotated to the target step, preserving each
 *    handle's `disabled` flag from the incoming list when present.
 *  - User-added custom handles (ids that are NOT shape handle ids) are rotated along
 *    the diamond perimeter by the delta between the incoming inferred rotation and the
 *    target rotation. If no rotation can be inferred from the incoming handles,
 *    the customs are kept at their current positions.
 *
 * If the resulting list would be identical to the shape's defaults at rotation 0 and
 * there are no extra custom handles, an empty array is returned (matching the
 * "no customHandles saved yet" convention used by the client).
 */
export function canonicalizeHandlesForRotation(
  type: ZoneType,
  shape: string | undefined,
  incomingHandles: CustomHandle[] | null | undefined,
  targetRotation: number,
): CustomHandle[] {
  const target = normalizeRotationSteps(targetRotation);

  // Hideouts / shapeless zones — rotation has no effect on handle positions.
  if (type === 'roadsHideout' || !shape) {
    return Array.isArray(incomingHandles) ? incomingHandles : [];
  }

  const defaults = getShapeHandlePositions(shape);
  if (defaults.length === 0) {
    return Array.isArray(incomingHandles) ? incomingHandles : [];
  }

  const incoming = Array.isArray(incomingHandles) ? incomingHandles : [];

  // If there are no incoming handles yet, return empty — defaults will be merged client-side.
  // We still record `rotation` separately, but with no customs saved, target == 0 by convention.
  if (incoming.length === 0 && target === 0) return [];

  // Build rotated shape handles, preserving disabled flag.
  const disabledById = new Map<string, boolean>();
  for (const h of incoming) {
    if (h.disabled) disabledById.set(h.id, true);
  }

  const rotatedShapeHandles: CustomHandle[] = defaults.map((def) => {
    const t = handlePosToT(def.left, def.top);
    const rotated = tToHandlePos(t + target);
    const out: CustomHandle = { id: def.id, left: rotated.left, top: rotated.top };
    if (disabledById.get(def.id)) out.disabled = true;
    return out;
  });

  // Determine what the incoming non-shape customs look like — and how to rotate them
  // along with the shape. We rotate them by (target - inferredFromIncoming).
  const inferredIncoming = inferRotationFromHandles(
    incoming.filter((h) => isShapeHandleId(h.id, shape)),
    defaults,
  );
  const customRotationDelta =
    inferredIncoming === null ? 0 : normalizeRotationSteps(target - inferredIncoming);

  const userCustoms: CustomHandle[] = [];
  for (const h of incoming) {
    if (isShapeHandleId(h.id, shape)) continue;
    if (h.id === 'center' || h.id === 'center-overlay') {
      userCustoms.push(h);
      continue;
    }
    if (customRotationDelta === 0) {
      userCustoms.push(h);
    } else {
      const t = handlePosToT(h.left, h.top);
      const rotated = tToHandlePos(t + customRotationDelta);
      userCustoms.push({ ...h, left: rotated.left, top: rotated.top });
    }
  }

  return [...rotatedShapeHandles, ...userCustoms];
}

/**
 * Verifies that the rotation value stored on a node is consistent with its handles.
 * Returns the inferred rotation from the shape handles when one can be unambiguously
 * inferred, or null otherwise (no handles / no shape / inconsistent).
 */
export function inferRotationForZone(
  type: ZoneType,
  shape: string | undefined,
  customHandles: CustomHandle[] | null | undefined,
): number | null {
  if (type === 'roadsHideout' || !shape) return null;
  const handles = Array.isArray(customHandles) ? customHandles : [];
  if (handles.length === 0) return null;
  const defaults = getShapeHandlePositions(shape);
  if (defaults.length === 0) return null;
  const shapeHandles = handles.filter((h) => isShapeHandleId(h.id, shape));
  if (shapeHandles.length === 0) return null;
  return inferRotationFromHandles(shapeHandles, defaults);
}
