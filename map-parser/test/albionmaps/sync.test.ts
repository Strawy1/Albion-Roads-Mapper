import { describe, it, expect, beforeAll } from 'vitest';
import { writeFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(__dirname, '../../scripts/syncMaps.ts');
// tsx's dist entry invoked via process.execPath: the .bin/tsx shim is a
// #!/bin/sh script that spawnSync cannot run on Windows.
const TSX_ENTRY = resolve(__dirname, '../../node_modules/tsx/dist/cli.mjs');
const FIXTURE_DIR = join(tmpdir(), 'albionmaps-sync-test');

interface GameMapFixture {
  mapID: string;
  mapName: string;
  mapType: string;
  tier: number;
  knownFeatures?: string[];
  isRoadsHideout?: boolean;
  baselineFeatures?: unknown;
}

function writeFixture(name: string, data: unknown): string {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const path = join(FIXTURE_DIR, name);
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data, null, 2), 'utf8');
  return path;
}

function runSync(extra: string[]): { stdout: string; stderr: string; exitCode: number } {
  const result = spawnSync(process.execPath, [TSX_ENTRY, SCRIPT, ...extra], {
    cwd: resolve(__dirname, '../..'),
    encoding: 'utf8',
    timeout: 60_000,
  });
  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.status ?? 1,
  };
}

const OUTPUT = join(FIXTURE_DIR, 'maps.json');

// Upstream feed fixture: 6 roads zones that ARE on Albion Maps (cache keyed by
// catalogue name), 1 roads zone the site does not carry, plus one outlands and
// one royal zone that must be left untouched by the enrichment stage.
const UPSTREAM: unknown[] = [
  { name: 'Setent-In-Qinsum', tier: 6 },
  { name: 'Quaent-Vynsum', tier: 6 },
  { name: 'Qiient-Odesas', tier: 6 },
  { name: 'Secent-Al-Duosom', tier: 6 },
  { name: 'Qiient-Al-Viesis', tier: 6 },
  { name: 'Suyites-Uzurtum', tier: 6 },
  // Not on Albion Maps — must keep its feed-derived features and be reported.
  { name: 'Tebitos-Odoxlum', tier: 4, icons: [{ alt: 'rock' }, { alt: 'hire' }] },
  { name: 'Avalanche Incline', tier: 8, color: 'black' },
  { name: 'Aspenwood', tier: 5, color: 'yellow' },
];

let sourcePath = '';
let cachePath = '';

beforeAll(() => {
  sourcePath = writeFixture('upstream.json', UPSTREAM);
  cachePath = resolve(__dirname, 'fixtures/albionmaps-cache.json');
  rmSync(OUTPUT, { force: true });
});

function readOutput(): GameMapFixture[] {
  return JSON.parse(readFileSync(OUTPUT, 'utf8')) as GameMapFixture[];
}

const byName = (list: GameMapFixture[], name: string): GameMapFixture => {
  const found = list.find((m) => m.mapName === name);
  if (!found) throw new Error(`missing ${name} in output`);
  return found;
};

describe('sync-maps with the Albion Maps enrichment stage', () => {
  it('enriches matched roads zones with authoritative static metadata', () => {
    const r = runSync(['--source', sourcePath, '--output', OUTPUT, '--albionmaps-source', cachePath]);
    expect(r.exitCode).toBe(0);

    const out = readOutput();
    const quaent = byName(out, 'Quaent-Vynsum');
    expect(quaent.tier).toBe(6);
    expect(quaent.isRoadsHideout).toBe(true); // HO tag
    expect(quaent.baselineFeatures).toEqual({
      chests: { largeGold: 0, smallGold: 0, blue: 1, green: 5 },
      dungeon: 0,
      resources: { hide: true, ore: false, fiber: false, wood: false, stone: false },
    });
    // knownFeatures is regenerated from the baseline, deterministically sorted.
    expect(quaent.knownFeatures).toEqual(['hide', 'largeBlueChest', 'largeGreenChest']);

    const suyites = byName(out, 'Suyites-Uzurtum');
    expect(suyites.isRoadsHideout).toBeUndefined(); // TUNNEL tag
    expect(suyites.baselineFeatures).toEqual({
      chests: { largeGold: 1, smallGold: 2, blue: 0, green: 0 },
      dungeon: 1,
      resources: { hide: false, ore: true, fiber: true, wood: false, stone: false },
    });
    expect(suyites.knownFeatures).toEqual(['cotton', 'largeGoldChest', 'ore']);
  });

  it('reports unmatched roads zones on stderr and keeps their fallback data', () => {
    const r = runSync(['--source', sourcePath, '--output', OUTPUT, '--albionmaps-source', cachePath]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain('Tebitos-Odoxlum');

    const tebitos = byName(readOutput(), 'Tebitos-Odoxlum');
    expect(tebitos.baselineFeatures).toBeUndefined();
    expect(tebitos.knownFeatures).toEqual(['hide', 'rock']); // feed-derived fallback
  });

  it('leaves non-roads zones untouched', () => {
    runSync(['--source', sourcePath, '--output', OUTPUT, '--albionmaps-source', cachePath]);
    const out = readOutput();
    expect(byName(out, 'Avalanche Incline').baselineFeatures).toBeUndefined();
    expect(byName(out, 'Aspenwood').baselineFeatures).toBeUndefined();
  });

  it('produces byte-identical output across runs (determinism)', () => {
    const args = ['--source', sourcePath, '--output', OUTPUT, '--albionmaps-source', cachePath];
    runSync(args);
    const first = readFileSync(OUTPUT, 'utf8');
    runSync(args);
    const second = readFileSync(OUTPUT, 'utf8');
    expect(second).toBe(first);
  });

  it('aborts without touching the previous dataset when the cache is broken', () => {
    const broken = writeFixture('broken-cache.json', 'this is not json');
    writeFileSync(OUTPUT, '{"sentinel": true}', 'utf8');
    const r = runSync(['--source', sourcePath, '--output', OUTPUT, '--albionmaps-source', broken]);
    expect(r.exitCode).not.toBe(0);
    expect(readFileSync(OUTPUT, 'utf8')).toBe('{"sentinel": true}');
  });

  it('--no-albionmaps skips enrichment entirely', () => {
    const r = runSync(['--source', sourcePath, '--output', OUTPUT, '--no-albionmaps']);
    expect(r.exitCode).toBe(0);
    const out = readOutput();
    expect(byName(out, 'Quaent-Vynsum').baselineFeatures).toBeUndefined();
  });
});
