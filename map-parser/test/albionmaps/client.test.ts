import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { searchUrl, parseCardsFromHtml } from '../../src/albionmaps/client.js';
import { AlbionMapsParseError } from '../../src/albionmaps/errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string): string =>
  readFileSync(resolve(__dirname, 'fixtures', name), 'utf8');

describe('searchUrl', () => {
  it('collapses catalogue hyphens to spaces (site search is token-based)', () => {
    expect(searchUrl('Suyites-Uzurtum')).toBe(
      'https://www.albionmaps.com.br/?lang=en&title=Suyites%20Uzurtum',
    );
  });

  it('collapses spaced hyphens (" - ") to a single space', () => {
    expect(searchUrl('Quaent - Vynsum')).toBe(
      'https://www.albionmaps.com.br/?lang=en&title=Quaent%20Vynsum',
    );
  });

  it('handles three-part names and trims stray whitespace', () => {
    expect(searchUrl('  Qiient-Al-Viesis ')).toBe(
      'https://www.albionmaps.com.br/?lang=en&title=Qiient%20Al%20Viesis',
    );
  });
});

describe('parseCardsFromHtml', () => {
  it('parses a single real card (Quaent - Vynsum)', () => {
    const cards = parseCardsFromHtml(fixture('card-quaent-vynsum.html'));
    expect(cards).toHaveLength(1);
    expect(cards[0].title).toBe('Quaent - Vynsum');
    expect(cards[0].tags).toBe('T6, HO, BLUE, GREEN ×5, Hide');
    expect(cards[0].tagsPayload.map((t) => t.tagName)).toEqual([
      'T6', 'HO', 'BLUE', 'GREEN', 'Hide',
    ]);
    const green = cards[0].tagsPayload.find((t) => t.tagName === 'GREEN')!;
    expect(green.quantity).toBe(5);
    expect(green.category).toBe('multiple');
    expect(green.tagId).toBe(10);
  });

  it('parses every card on a multi-card page (real capture)', () => {
    const cards = parseCardsFromHtml(fixture('cards-sample.html'));
    expect(cards).toHaveLength(6);
    expect(cards.map((c) => c.title)).toEqual([
      'Setent - In - Qinsum',
      'Quaent - Vynsum',
      'Qiient - Odesas',
      'Secent - Al - Duosom',
      'Qiient - Al - Viesis',
      'Suyites - Uzurtum',
    ]);
  });

  it('returns an empty list for a page with no cards', () => {
    expect(parseCardsFromHtml(fixture('cards-empty.html'))).toEqual([]);
  });

  it('dedupes cards rendered twice on the page (save-button + thumbnail)', () => {
    // The real site emits the full attribute set twice per zone; the parser
    // must not report a zone twice or the matcher would call it ambiguous.
    const cards = parseCardsFromHtml(fixture('card-quaent-vynsum.html'));
    expect(cards).toHaveLength(1);
    const sample = parseCardsFromHtml(fixture('cards-sample.html'));
    expect(sample).toHaveLength(6);
  });

  it('throws AlbionMapsParseError on a truncated/malformed payload', () => {
    expect(() => parseCardsFromHtml(fixture('cards-malformed.html'))).toThrow(
      AlbionMapsParseError,
    );
  });
});
