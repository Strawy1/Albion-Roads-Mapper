import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCardsFromHtml } from '../../src/albionmaps/client.js';
import { normalizeCard } from '../../src/albionmaps/normalize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');

const card = (tagName: string, category: 'single' | 'multiple' = 'multiple', quantity = 1) => ({
  title: 'Test - Zone',
  tags: tagName,
  tagsPayload: [{ tagId: 999, tagName, category, quantity }],
});

function baselineFor(title: string) {
  const cards = parseCardsFromHtml(fixture('cards-sample.html'));
  const card = cards.find((c) => c.title === title);
  if (!card) throw new Error(`fixture card not found: ${title}`);
  return normalizeCard(card);
}

describe('normalizeCard — real captured data', () => {
  it('Quaent - Vynsum → T6, HO, blue 1, green 5, hide', () => {
    const b = baselineFor('Quaent - Vynsum');
    expect(b.tier).toBe(6);
    expect(b.zoneType).toBe('HO');
    expect(b.chests).toEqual({ largeGold: 0, smallGold: 0, blue: 1, green: 5 });
    expect(b.dungeon).toBe(0);
    expect(b.resources).toEqual({ hide: true, ore: false, fiber: false, wood: false, stone: false });
    expect(b.unknownTags).toEqual([]);
  });

  it('Suyites - Uzurtum → T6, TUNNEL, L GOLD 1, S GOLD 2, DG 1, ore + fiber', () => {
    const b = baselineFor('Suyites - Uzurtum');
    expect(b.tier).toBe(6);
    expect(b.zoneType).toBe('TUNNEL');
    expect(b.chests).toEqual({ largeGold: 1, smallGold: 2, blue: 0, green: 0 });
    expect(b.dungeon).toBe(1);
    expect(b.resources).toEqual({ hide: false, ore: true, fiber: true, wood: false, stone: false });
  });

  it('Qiient - Al - Viesis → hide ×2 still yields a boolean presence', () => {
    const b = baselineFor('Qiient - Al - Viesis');
    expect(b.resources.hide).toBe(true);
  });
});

describe('normalizeCard — tag vocabulary mapping', () => {
  it('maps L GOLD → largeGold (count)', () => {
    expect(normalizeCard(card('L GOLD')).chests.largeGold).toBe(1);
  });
  it('maps S GOLD → smallGold (count)', () => {
    expect(normalizeCard(card('S GOLD', 'multiple', 2)).chests.smallGold).toBe(2);
  });
  it('maps BLUE → blue (count)', () => {
    expect(normalizeCard(card('BLUE')).chests.blue).toBe(1);
  });
  it('maps GREEN → green (count)', () => {
    expect(normalizeCard(card('GREEN', 'multiple', 6)).chests.green).toBe(6);
  });
  it('maps DG → dungeon (count)', () => {
    expect(normalizeCard(card('DG', 'multiple', 3)).dungeon).toBe(3);
  });
  it('maps each resource to a boolean presence', () => {
    const b = normalizeCard({
      title: 'T - Z',
      tags: '',
      tagsPayload: [
        { tagId: 14, tagName: 'Hide', category: 'multiple', quantity: 1 },
        { tagId: 16, tagName: 'Ore', category: 'multiple', quantity: 2 },
        { tagId: 15, tagName: 'Fiber', category: 'multiple', quantity: 1 },
        { tagId: 18, tagName: 'Wood', category: 'multiple', quantity: 1 },
        { tagId: 17, tagName: 'Stone', category: 'multiple', quantity: 1 },
      ],
    });
    expect(b.resources).toEqual({ hide: true, ore: true, fiber: true, wood: true, stone: true });
  });
  it('maps tier tags T4/T6/T8 to numbers', () => {
    expect(normalizeCard(card('T4', 'single')).tier).toBe(4);
    expect(normalizeCard(card('T6', 'single')).tier).toBe(6);
    expect(normalizeCard(card('T8', 'single')).tier).toBe(8);
  });
  it('maps zone-type tags', () => {
    expect(normalizeCard(card('HO', 'single')).zoneType).toBe('HO');
    expect(normalizeCard(card('TUNNEL', 'single')).zoneType).toBe('TUNNEL');
    expect(normalizeCard(card('GROUP PORTAL', 'single')).zoneType).toBe('GROUP_PORTAL');
  });
});

describe('normalizeCard — edge cases', () => {
  it('card with no tags → all-null baseline', () => {
    const b = normalizeCard({ title: 'Empty - Zone', tags: '', tagsPayload: [] });
    expect(b.tier).toBeNull();
    expect(b.zoneType).toBeNull();
    expect(b.chests).toEqual({ largeGold: 0, smallGold: 0, blue: 0, green: 0 });
    expect(b.dungeon).toBe(0);
    expect(b.resources).toEqual({ hide: false, ore: false, fiber: false, wood: false, stone: false });
  });

  it('unknown tag is collected in unknownTags, not silently dropped', () => {
    const b = normalizeCard(card('MYSTERY TAG'));
    expect(b.unknownTags).toContain('MYSTERY TAG');
  });

  it('missing/NaN quantity is treated as zero, not a crash', () => {
    const b = normalizeCard({
      title: 'Q - Z',
      tags: '',
      tagsPayload: [{ tagId: 10, tagName: 'GREEN', category: 'multiple', quantity: NaN }],
    });
    expect(b.chests.green).toBe(0);
  });
});
