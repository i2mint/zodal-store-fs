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
  it.each(['json', 'JSON', 'x.json', '.json', 'json ', 'a/b', 'bin.', ''])('rejects contentExtension %j', (contentExtension) => {
    expect(() => createFsContentProvider({ path: dir, contentFields: ['body'], contentExtension })).toThrow(
      /collide with item metadata/,
    );
  });

  it.each(['bin', 'txt', 'md', 'jsonl', 'my-ext_2'])('accepts contentExtension %j', (contentExtension) => {
    expect(() => createFsContentProvider({ path: dir, contentFields: ['body'], contentExtension })).not.toThrow();
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

  it('an own id: undefined (a form payload) keeps the stored id', async () => {
    const provider = factory();
    await provider.create({ id: 'a', name: 'A' });
    expect(await provider.update('a', { id: undefined, name: 'B' })).toMatchObject({ id: 'a', name: 'B' });
    expect(await provider.getOne('a')).toMatchObject({ id: 'a', name: 'B' });
    await expect(provider.getOne('undefined')).rejects.toThrow();
  });

  it('updateMany refuses before touching any item', async () => {
    const provider = factory();
    await provider.create({ id: 'a', name: 'A' });
    await provider.create({ id: 'b', name: 'B' });
    await expect(provider.updateMany!(['a', 'b'], { id: 'a', name: 'X' })).rejects.toThrow(/Cannot change "id"/);
    expect(await provider.getOne('a')).toMatchObject({ name: 'A' });
  });
});

describe.each(['directory', 'file'] as const)('createFsProvider (%s): upsert', (mode) => {
  it.each([{ n: 3 }, { id: null, n: 3 }])('throws without an id (%j)', async (data) => {
    const path = mode === 'file' ? join(dir, 'items.json') : dir;
    const provider = createFsProvider<any>({ path, mode });
    await expect(provider.upsert!(data)).rejects.toThrow(/upsert needs data\.id/);
    expect((await provider.getList({})).total).toBe(0);
  });
});

describe('createFsBlobProvider.create', () => {
  it('throws without an id instead of writing under "undefined"', async () => {
    const provider = createFsBlobProvider<any>({ path: dir, contentFields: ['body'] });
    await expect(provider.create({ body: 'x' })).rejects.toThrow(/needs data\.id/);
    expect(readdirSync(dir)).toEqual([]);
  });
});
