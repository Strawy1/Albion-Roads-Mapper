import { describe, it, expect } from 'vitest';
import {
  rotationStepsToDegrees,
  rotateClockwise,
  rotateCounterClockwise,
  normalizeRotationSteps,
  inferRotationFromHandles,
  canonicalizeHandlesForRotation,
  inferRotationForZone,
  getShapeHandlePositions
} from '../src';

describe('rotationStepsToDegrees', () => {
  it('returns 0 degrees for step 0 (default orientation)', () => {
    expect(rotationStepsToDegrees(0)).toBe(0);
  });

  it('returns 90 degrees for step 1 (one clockwise rotation)', () => {
    expect(rotationStepsToDegrees(1)).toBe(90);
  });

  it('returns 180 degrees for step 2 (two clockwise rotations)', () => {
    expect(rotationStepsToDegrees(2)).toBe(180);
  });

  it('returns 270 degrees for step 3 (three clockwise rotations)', () => {
    expect(rotationStepsToDegrees(3)).toBe(270);
  });

  it('wraps step 4 back to 0 degrees', () => {
    expect(rotationStepsToDegrees(4)).toBe(0);
  });

  it('handles negative steps correctly (step -1 = 270 degrees)', () => {
    expect(rotationStepsToDegrees(-1)).toBe(270);
  });
});

describe('rotateClockwise', () => {
  it('rotates from step 0 to step 1 (90 degrees clockwise)', () => {
    expect(rotateClockwise(0)).toBe(1);
  });

  it('rotates from step 1 to step 2', () => {
    expect(rotateClockwise(1)).toBe(2);
  });

  it('rotates from step 3 back to step 0 (wraps around)', () => {
    expect(rotateClockwise(3)).toBe(0);
  });
});

describe('rotateCounterClockwise', () => {
  it('rotates from step 1 to step 0', () => {
    expect(rotateCounterClockwise(1)).toBe(0);
  });

  it('rotates from step 0 to step 3 (wraps around)', () => {
    expect(rotateCounterClockwise(0)).toBe(3);
  });

  it('rotates from step 2 to step 1', () => {
    expect(rotateCounterClockwise(2)).toBe(1);
  });
});

describe('rotation save scenario', () => {
  it('rotating a node 90 degrees clockwise from default results in step 1 saved', () => {
    const initialRotation = 0;
    const afterOneClockwise = rotateClockwise(initialRotation);
    expect(afterOneClockwise).toBe(1);
    expect(rotationStepsToDegrees(afterOneClockwise)).toBe(90);
  });

  it('rotating a node 180 degrees (two clockwise steps) results in step 2 saved', () => {
    const afterTwoClockwise = rotateClockwise(rotateClockwise(0));
    expect(afterTwoClockwise).toBe(2);
    expect(rotationStepsToDegrees(afterTwoClockwise)).toBe(180);
  });
});

// ─── normalizeRotationSteps ───────────────────────────────────────────────────

describe('normalizeRotationSteps', () => {
  it('returns 0 for 0', () => expect(normalizeRotationSteps(0)).toBe(0));
  it('returns 1 for 1', () => expect(normalizeRotationSteps(1)).toBe(1));
  it('returns 3 for 3', () => expect(normalizeRotationSteps(3)).toBe(3));
  it('wraps 4 → 0', () => expect(normalizeRotationSteps(4)).toBe(0));
  it('wraps 5 → 1', () => expect(normalizeRotationSteps(5)).toBe(1));
  it('wraps -1 → 3', () => expect(normalizeRotationSteps(-1)).toBe(3));
  it('wraps -4 → 0', () => expect(normalizeRotationSteps(-4)).toBe(0));
  it('returns 0 for null', () => expect(normalizeRotationSteps(null)).toBe(0));
  it('returns 0 for undefined', () => expect(normalizeRotationSteps(undefined)).toBe(0));
  it('returns 0 for NaN', () => expect(normalizeRotationSteps(NaN)).toBe(0));
});

// ─── inferRotationFromHandles ─────────────────────────────────────────────────

describe('inferRotationFromHandles', () => {
  it('returns null for empty actual handles', () => {
    const defaults = getShapeHandlePositions('c');
    expect(inferRotationFromHandles([], defaults)).toBeNull();
  });

  it('returns null for empty default handles', () => {
    const defaults = getShapeHandlePositions('c');
    expect(inferRotationFromHandles(defaults, [])).toBeNull();
  });

  it('returns null when counts differ', () => {
    const defaults = getShapeHandlePositions('c');
    expect(inferRotationFromHandles(defaults.slice(0, 3), defaults)).toBeNull();
  });

  it('returns 0 when actual handles match defaults exactly', () => {
    const defaults = getShapeHandlePositions('c');
    expect(inferRotationFromHandles(defaults, defaults)).toBe(0);
  });

  it('returns null when a handle id is missing from actuals', () => {
    const defaults = getShapeHandlePositions('c');
    // Replace one id so it won't be found
    const broken = defaults.map((h, i) => i === 0 ? { ...h, id: 'wrong-id' } : h);
    expect(inferRotationFromHandles(broken, defaults)).toBeNull();
  });

  it('returns null when handles do not agree on a single rotation', () => {
    const defaults = getShapeHandlePositions('c');
    // Mix positions from different rotation steps so votes disagree
    const mixed = defaults.map((h, i) => i % 2 === 0 ? h : { ...h, left: '50.00%', top: '0.00%' });
    expect(inferRotationFromHandles(mixed, defaults)).toBeNull();
  });

  it('returns null for the problematic oouitos-alaiam data (desynced handle)', () => {
    const defaults = getShapeHandlePositions('o');
    const problematic = [
      { id: "o-p1", top: "38.00%", left: "12.00%" },
      { id: "o-p2", top: "11.20%", left: "61.20%" },
      { id: "o-p3", top: "31.40%", left: "81.40%" },
      { id: "o-p4", top: "61.20%", left: "88.80%" },
      { id: "o-p5", top: "88.00%", left: "62.00%" },
      { id: "o-p6", top: "68.80%", left: "18.80%" }
    ];
    // In previous versions this might have returned 3 (due to rounding)
    // but with tolerance check it should return null because o-p2 is way off.
    expect(inferRotationFromHandles(problematic, defaults)).toBeNull();
  });
});

// ─── canonicalizeHandlesForRotation ──────────────────────────────────────────

describe('canonicalizeHandlesForRotation', () => {
  it('returns incoming handles unchanged for roadsHideout type', () => {
    const handles = [{ id: 'n', left: '75%', top: '25%' }];
    const result = canonicalizeHandlesForRotation('roadsHideout', 'c', handles, 1);
    expect(result).toEqual(handles);
  });

  it('returns incoming handles unchanged when shape is undefined', () => {
    const handles = [{ id: 'x', left: '50%', top: '50%' }];
    const result = canonicalizeHandlesForRotation('roads', undefined, handles, 2);
    expect(result).toEqual(handles);
  });

  it('returns empty array for null incoming handles with unknown shape', () => {
    const result = canonicalizeHandlesForRotation('roads', undefined, null, 1);
    expect(result).toEqual([]);
  });

  it('returns empty array when no incoming handles and target rotation is 0', () => {
    const result = canonicalizeHandlesForRotation('roads', 'c', [], 0);
    expect(result).toEqual([]);
  });

  it('returns empty array when null incoming handles and target rotation is 0', () => {
    const result = canonicalizeHandlesForRotation('roads', 'c', null, 0);
    expect(result).toEqual([]);
  });

  it('produces handles for all shape positions when rotating from default (0→1)', () => {
    const defaults = getShapeHandlePositions('c');
    const result = canonicalizeHandlesForRotation('roads', 'c', defaults, 1);
    // All shape handle ids must be present
    const ids = result.map(h => h.id);
    for (const def of defaults) {
      expect(ids).toContain(def.id);
    }
    // Positions must differ from defaults (rotation was applied)
    const movedCount = result.filter((h, _) => {
      const def = defaults.find(d => d.id === h.id);
      return def && (h.left !== def.left || h.top !== def.top);
    }).length;
    expect(movedCount).toBeGreaterThan(0);
  });

  it('round-trips: rotating 0→1→2→3→0 returns to default positions', () => {
    const defaults = getShapeHandlePositions('c');
    let handles = [...defaults];
    for (let step = 1; step <= 4; step++) {
      handles = canonicalizeHandlesForRotation('roads', 'c', handles, step % 4);
    }
    // After 4 steps we should be back at rotation 0 — positions match defaults
    for (const def of defaults) {
      const h = handles.find(x => x.id === def.id);
      expect(h).toBeDefined();
      expect(parseFloat(h!.left)).toBeCloseTo(parseFloat(def.left), 1);
      expect(parseFloat(h!.top)).toBeCloseTo(parseFloat(def.top), 1);
    }
  });

  it('preserves disabled flag on shape handles', () => {
    const defaults = getShapeHandlePositions('c');
    const withDisabled = defaults.map((h, i) => i === 0 ? { ...h, disabled: true } : h);
    const result = canonicalizeHandlesForRotation('roads', 'c', withDisabled, 1);
    const first = result.find(h => h.id === defaults[0].id);
    expect(first?.disabled).toBe(true);
    // Other handles should not have disabled set
    const others = result.filter(h => h.id !== defaults[0].id && h.id.startsWith('c-'));
    for (const h of others) {
      expect(h.disabled).toBeFalsy();
    }
  });

  it('keeps center/center-overlay handles at their original position regardless of rotation', () => {
    const defaults = getShapeHandlePositions('c');
    const centerHandle = { id: 'center', left: '50.00%', top: '50.00%' };
    const incoming = [...defaults, centerHandle];
    const result = canonicalizeHandlesForRotation('roads', 'c', incoming, 2);
    const center = result.find(h => h.id === 'center');
    expect(center).toBeDefined();
    expect(center!.left).toBe('50.00%');
    expect(center!.top).toBe('50.00%');
  });

  it('rotates user-added custom handles along with the shape', () => {
    const defaults = getShapeHandlePositions('c');
    // Place a custom handle at the top of the diamond (t≈0)
    const customHandle = { id: 'my-custom', left: '50.00%', top: '0.00%' };
    const incoming = [...defaults, customHandle];
    // Rotate by 1 step — the custom should move to the right side (t≈1)
    const result = canonicalizeHandlesForRotation('roads', 'c', incoming, 1);
    const moved = result.find(h => h.id === 'my-custom');
    expect(moved).toBeDefined();
    // After 1 step clockwise, top (t=0) → right (t=1): left≈100%, top≈50%
    expect(parseFloat(moved!.left)).toBeCloseTo(100, 0);
    expect(parseFloat(moved!.top)).toBeCloseTo(50, 0);
  });

  it('normalizes out-of-range target rotation (e.g. 5 → 1)', () => {
    const defaults = getShapeHandlePositions('c');
    const result5 = canonicalizeHandlesForRotation('roads', 'c', defaults, 5);
    const result1 = canonicalizeHandlesForRotation('roads', 'c', defaults, 1);
    expect(result5).toEqual(result1);
  });
});

// ─── inferRotationForZone ─────────────────────────────────────────────────────

describe('inferRotationForZone', () => {
  it('returns null for roadsHideout type', () => {
    const defaults = getShapeHandlePositions('c');
    expect(inferRotationForZone('roadsHideout', 'c', defaults)).toBeNull();
  });

  it('returns null when shape is undefined', () => {
    const defaults = getShapeHandlePositions('c');
    expect(inferRotationForZone('roads', undefined, defaults)).toBeNull();
  });

  it('returns null for null customHandles', () => {
    expect(inferRotationForZone('roads', 'c', null)).toBeNull();
  });

  it('returns null for empty customHandles', () => {
    expect(inferRotationForZone('roads', 'c', [])).toBeNull();
  });

  it('returns null when customHandles contain no shape handle ids', () => {
    const handles = [{ id: 'center', left: '50%', top: '50%' }];
    expect(inferRotationForZone('roads', 'c', handles)).toBeNull();
  });

  it('returns 0 when handles match default positions', () => {
    const defaults = getShapeHandlePositions('c');
    expect(inferRotationForZone('roads', 'c', defaults)).toBe(0);
  });

  it('returns the correct rotation step after canonicalization', () => {
    const defaults = getShapeHandlePositions('c');
    for (let step = 0; step < 4; step++) {
      const rotated = canonicalizeHandlesForRotation('roads', 'c', defaults, step);
      // inferRotationForZone should recover the step we applied
      expect(inferRotationForZone('roads', 'c', rotated)).toBe(step);
    }
  });

  it('ignores non-shape handles when inferring rotation', () => {
    const defaults = getShapeHandlePositions('c');
    const rotated1 = canonicalizeHandlesForRotation('roads', 'c', defaults, 1);
    // Add a stray handle that doesn't belong to the shape
    const withExtra = [...rotated1, { id: 'stray', left: '10%', top: '10%' }];
    expect(inferRotationForZone('roads', 'c', withExtra)).toBe(1);
  });

  it('works correctly for shape "f"', () => {
    const defaults = getShapeHandlePositions('f');
    const rotated2 = canonicalizeHandlesForRotation('roads', 'f', defaults, 2);
    expect(inferRotationForZone('roads', 'f', rotated2)).toBe(2);
  });

  it('works correctly for shape "x"', () => {
    const defaults = getShapeHandlePositions('x');
    const rotated3 = canonicalizeHandlesForRotation('roads', 'x', defaults, 3);
    expect(inferRotationForZone('roads', 'x', rotated3)).toBe(3);
  });
});

// ─── desync self-heal scenario ────────────────────────────────────────────────

describe('desync self-heal scenario', () => {
  it('canonicalizeHandlesForRotation fixes handles that are at rotation 1 but target is 0', () => {
    const defaults = getShapeHandlePositions('c');
    // Simulate a desync: handles are at rotation 1 but we want rotation 0
    const desynced = canonicalizeHandlesForRotation('roads', 'c', defaults, 1);
    const fixed = canonicalizeHandlesForRotation('roads', 'c', desynced, 0);
    // After fixing, inferred rotation should be 0
    expect(inferRotationForZone('roads', 'c', fixed)).toBe(0);
  });

  it('inferRotationForZone detects a mismatch between stored rotation and handle layout', () => {
    const defaults = getShapeHandlePositions('c');
    // Handles are at rotation 2 but stored rotation claims 0
    const handlesAtRot2 = canonicalizeHandlesForRotation('roads', 'c', defaults, 2);
    const inferred = inferRotationForZone('roads', 'c', handlesAtRot2);
    const storedRotation = 0;
    expect(inferred).not.toBe(storedRotation); // desync detected
    expect(inferred).toBe(2);
  });

  it('a zone reset (rotation 0, empty handles) is consistent', () => {
    // After a reset the client sends rotation=0 and no customHandles
    const result = canonicalizeHandlesForRotation('roads', 'c', [], 0);
    expect(result).toEqual([]);
    // inferRotationForZone on empty handles returns null (no handles = default = 0 by convention)
    expect(inferRotationForZone('roads', 'c', [])).toBeNull();
  });
});
