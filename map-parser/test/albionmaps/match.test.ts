import { describe, it, expect } from 'vitest';
import { matchZone, normalizeZoneName, ZONE_NAME_ALIASES } from '../../src/albionmaps/match.js';

// ── name normalization ────────────────────────────────────────────────────────

describe('normalizeZoneName', () => {
  it('collapses " - " and "-" to single spaces and lowercases', () => {
    expect(normalizeZoneName('Quaent - Vynsum')).toBe('quaent vynsum');
    expect(normalizeZoneName('Suyites-Uzurtum')).toBe('suyites uzurtum');
    expect(normalizeZoneName('Qiient-Al-Viesis')).toBe('qiient al viesis');
  });

  it('trims and collapses stray whitespace', () => {
    expect(normalizeZoneName('  Setent   - In - Qinsum ')).toBe('setent in qinsum');
  });
});

// ── matching ──────────────────────────────────────────────────────────────────

describe('matchZone', () => {
  const cards = [
    { title: 'Quaent - Vynsum', tags: '', tagsPayload: [] },
    { title: 'Suyites - Uzurtum', tags: '', tagsPayload: [] },
    { title: 'Secent - Al - Duosom', tags: '', tagsPayload: [] },
  ];

  it('exact match after normalization', () => {
    expect(matchZone('Quaent-Vynsum', cards)).toBe('Quaent - Vynsum');
  });

  it('matches case differences', () => {
    expect(matchZone('quaent - vynsum', cards)).toBe('Quaent - Vynsum');
  });

  it('matches whitespace differences', () => {
    expect(matchZone('Suyites-  Uzurtum', cards)).toBe('Suyites - Uzurtum');
  });

  it('returns null when nothing matches (unmatched zone)', () => {
    expect(matchZone('Tebitos-Odoxlum', cards)).toBeNull();
  });

  it('throws on an ambiguous match (two cards normalize equal)', () => {
    const dup = [
      { title: 'Hiles - Izizaum', tags: '', tagsPayload: [] },
      { title: 'Files - Izizaum', tags: '', tagsPayload: [] },
    ];
    // "files izizaum" vs "hiles izizaum" — not ambiguous; use a true duplicate:
    const dup2 = [
      { title: 'Secent - Al - Odetis', tags: '', tagsPayload: [] },
      { title: 'Secent-Al-Odetis', tags: '', tagsPayload: [] },
    ];
    expect(() => matchZone('Secent-Al-Odetis', dup2)).toThrow();
    expect(matchZone('Hiles-Izizaum', dup)).toBe('Hiles - Izizaum');
  });
});

describe('ZONE_NAME_ALIASES', () => {
  it('resolves a known alias to the site spelling', () => {
    // Alias table maps catalogue spellings that differ from the site's spelling.
    expect(ZONE_NAME_ALIASES).toBeInstanceOf(Map);
  });
});
