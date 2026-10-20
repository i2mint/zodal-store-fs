import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFsProvider, createFsContentProvider, createFsBlobProvider } from '../src/index.js';

// Follow-ups to the path-safety work (#4): ids that are safe path segments but could
// still write somewhere other than the caller asked.

let dir: string;
beforeEach(() => {
  dir = join(tmpdir(), `zodal-fs-ids-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
});
afterEach(() => {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe('createFsContentProvider: sidecars cannot collide with metadata', () => {
  it.each(['json', 'JSON'])("rejects contentExtension %j", (contentExtension) => {
    expect(() => createFsContentProvider({ path: dir, contentFields: ['body'], contentExtension })).toThrow(
      /collide with item metadata/,
    );
  });
});

describe.each([
  ['createFsProvider (directory)', () => createFsProvider<any>({ path: dir, mode: 'directory' })],
  ['createFsProvider (file)', () => createFsProvider<any>({ path: join(dir, 'items.json'), mode: 'file' })],
  ['createFsContentProvider', () => createFsContentProvider<any>({ path: dir, contentFields: ['body'] })],
] as const)('%s: an update cannot change the id', (_name, factory) => {
  it('update refuses data whose id differs, and writes nothing', async () => {
    const provider = factory();
    await provider.create({ id: 'a', name: 'A' });
    await expect(provider.update('a', { id: 'other', name: 'B' })).rejects.toThrow(/Cannot change "id"/);
    expect(await provider.getOne('a')).toMatchObject({ id: 'a', name: 'A' });
    await expect(provider.getOne('other')).rejects.toThrow();
  });

  it('update accepts data carrying the same id (a whole record from a form)', async () => {
    const provider = factory();
    await provider.create({ id: 'a', name: 'A' });
    expect(await provider.update('a', { id: 'a', name: 'B' })).toMatchObject({ id: 'a', name: 'B' });
  });

  it('updateMany refuses before touching any item', async () => {
    const provider = factory();
    await provider.create({ id: 'a', name: 'A' });
    await provider.create({ id: 'b', name: 'B' });
    await expect(provider.updateMany!(['a', 'b'], { id: 'a', name: 'X' })).rejects.toThrow(/Cannot change "id"/);
    expect(await provider.getOne('a')).toMatchObject({ name: 'A' });
  });
});

describe('createFsBlobProvider.create', () => {
  it('throws without an id instead of writing under "undefined"', async () => {
    const provider = createFsBlobProvider<any>({ path: dir, contentFields: ['body'] });
    await expect(provider.create({ body: 'x' })).rejects.toThrow(/needs data\.id/);
    expect(readdirSync(dir)).toEqual([]);
  });
});
