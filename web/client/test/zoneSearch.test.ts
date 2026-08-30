import { describe, it, expect } from 'vitest';
import { matchesZoneQuery, zoneQueryScore, splitZoneWords } from '../src/utils/zoneSearch.js';

describe('splitZoneWords', () => {
  it('splits hyphenated and spaced names into lowercase words', () => {
    expect(splitZoneWords('Quaent-Vynsum')).toEqual(['quaent', 'vynsum']);
    expect(splitZoneWords('Quaent - Vynsum')).toEqual(['quaent', 'vynsum']);
    expect(splitZoneWords('Adrens Hill')).toEqual(['adrens', 'hill']);
    expect(splitZoneWords('Qiient-Al-Viesis')).toEqual(['qiient', 'al', 'viesis']);
  });
});

describe('matchesZoneQuery — two-letter prefix convention', () => {
  it('"ce av" matches Cetos-style two-part names', () => {
    expect(matchesZoneQuery('Cases-Ugumlos', 'ce av')).toBe(false); // "ca ug" would
    expect(matchesZoneQuery('Quaent-Vynsum', 'qu vy')).toBe(true);
  });

  it('community example: "ce av" → a Ce* zone with Av* suffix', () => {
    expect(matchesZoneQuery('Cetos-Avixnum', 'ce av')).toBe(true);
  });

  it('matches three-part names token by token', () => {
    expect(matchesZoneQuery('Qiient-Al-Viesis', 'qi al v')).toBe(true);
    expect(matchesZoneQuery('Qiient-Al-Viesis', 'qi viesis')).toBe(true);
  });

  it('is case-insensitive and trims whitespace', () => {
    expect(matchesZoneQuery('Setent-In-Qinsum', '  SE IN QIN ')).toBe(true);
  });

  it('matches a single prefix token', () => {
    expect(matchesZoneQuery('Setent-In-Qinsum', 'set')).toBe(true);
    expect(matchesZoneQuery('Suyites-Uzurtum', 'suy')).toBe(true);
  });

  it('matches hyphenated queries (tokens split on any separator)', () => {
    expect(matchesZoneQuery('Quaent-Vynsum', 'qu-vy')).toBe(true);
    expect(matchesZoneQuery('Adrens Hill', 'adrens-hill')).toBe(true);
  });

  it('falls back to substring for partial-word queries', () => {
    expect(matchesZoneQuery('Quaent-Vynsum', 'vyns')).toBe(true);
    expect(matchesZoneQuery('Quaent-Vynsum', 'nt-vy')).toBe(true);
  });

  it('empty query matches everything', () => {
    expect(matchesZoneQuery('Quaent-Vynsum', '')).toBe(true);
    expect(matchesZoneQuery('Quaent-Vynsum', '   ')).toBe(true);
  });

  it('rejects non-matching queries', () => {
    expect(matchesZoneQuery('Quaent-Vynsum', 'zz')).toBe(false);
    expect(matchesZoneQuery('Suyites-Uzurtum', 'qu vy')).toBe(false);
    expect(matchesZoneQuery('Qiient-Al-Viesis', 'qi vi odesum')).toBe(false);
  });
});

describe('zoneQueryScore — ranking', () => {
  it('full prefix-token matches outrank substring-only matches', () => {
    expect(zoneQueryScore('Quaent-Vynsum', 'qu vy')).toBeGreaterThan(zoneQueryScore('Suyites-Uzurtum', 'qu vy'));
    // "ca ug" prefix-matches Cases-Ugumlos but nothing in Suyites-Uzurtum:
    expect(zoneQueryScore('Cases-Ugumlos', 'ca ug')).toBeGreaterThan(zoneQueryScore('Suyites-Uzurtum', 'ca ug'));
  });

  it('prefix match scores above plain substring match on the same name', () => {
    expect(zoneQueryScore('Quaent-Vynsum', 'quaent')).toBeGreaterThan(zoneQueryScore('Quaent-Vynsum', 'ynsum'));
    // "ynsum" is substring-only (no word starts with it); "quaent" is a full word prefix.
  });

  it('non-matching queries score 0', () => {
    expect(zoneQueryScore('Quaent-Vynsum', 'zz')).toBe(0);
  });
});
