import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { DataProvider } from '@zodal/store';
import { createFsProvider, createFsContentProvider, createFsBlobProvider } from '../src/index.js';
import { assertSafeId } from '../src/safe-id.js';

const UNSAFE_IDS = ['', '.', '..', '../victim', '..\\victim', 'a/b', '/etc/hosts', 'C:\\x', 'a\0b'];
const SAFE_IDS = ['abc', '123', 'a.b', 'a..b', '...', '.hidden', 'with space', 'é'];

describe('assertSafeId', () => {
  it.each(UNSAFE_IDS)('rejects %j', (id) => {
    expect(() => assertSafeId(id)).toThrow(/Unsafe id/);
  });

  it.each(SAFE_IDS)('accepts %j', (id) => {
    expect(assertSafeId(id)).toBe(id);
  });
});

type Factory = (storePath: string) => DataProvider<any>;

const providers: [string, Factory][] = [
  ['createFsProvider (directory)', (path) => createFsProvider({ path, mode: 'directory' })],
  ['createFsContentProvider', (path) => createFsContentProvider({ path, contentFields: ['body'] })],
  ['createFsBlobProvider', (path) => createFsBlobProvider({ path, contentFields: ['body'] })],
];

describe.each(providers)('%s: ids cannot escape the store', (_name, factory) => {
  // Layout: {root}/store is the store; {root}/victim.json and {root}/victim/ sit outside it.
  let root: string;
  let provider: DataProvider<any>;

  beforeEach(() => {
    root = join(tmpdir(), `zodal-fs-safe-id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(root, 'store'), { recursive: true });
    writeFileSync(join(root, 'victim.json'), JSON.stringify({ id: 'victim', secret: true }));
    mkdirSync(join(root, 'victim'));
    writeFileSync(join(root, 'victim', 'body.bin'), 'secret');
    provider = factory(join(root, 'store'));
  });

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  function outsideUntouched(): void {
    expect(readdirSync(root).sort()).toEqual(['store', 'victim', 'victim.json']);
    expect(readdirSync(join(root, 'victim'))).toEqual(['body.bin']);
  }

  it('getOne rejects a traversing id', async () => {
    await expect(provider.getOne('../victim')).rejects.toThrow(/Unsafe id/);
  });

  it('create rejects a traversing id and writes nothing outside', async () => {
    await expect(provider.create({ id: '../evil', body: 'x' })).rejects.toThrow(/Unsafe id/);
    outsideUntouched();
  });

  it('update rejects a traversing id and writes nothing outside', async () => {
    await expect(provider.update('../victim', { name: 'x', body: 'x' })).rejects.toThrow(/Unsafe id/);
    outsideUntouched();
  });

  it('delete rejects a traversing id and deletes nothing outside', async () => {
    await expect(provider.delete('../victim')).rejects.toThrow(/Unsafe id/);
    outsideUntouched();
  });

  it('deleteMany rejects a traversing id and deletes nothing outside', async () => {
    await expect(provider.deleteMany!(['../victim'])).rejects.toThrow(/Unsafe id/);
    outsideUntouched();
  });

  it('rejects an absolute path as id', async () => {
    await expect(provider.getOne(join(root, 'victim'))).rejects.toThrow(/Unsafe id/);
    await expect(provider.delete(join(root, 'victim'))).rejects.toThrow(/Unsafe id/);
    outsideUntouched();
  });

  it('still round-trips an ordinary id containing dots', async () => {
    await provider.create({ id: 'a..b', name: 'ok', body: 'x' });
    const item = await provider.getOne('a..b');
    expect(item.id).toBe('a..b');
    outsideUntouched();
  });
});

describe('createFsProvider (file mode): ids are not paths', () => {
  it('accepts ids with separators, since they never reach the filesystem', async () => {
    const root = join(tmpdir(), `zodal-fs-safe-id-file-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(root, { recursive: true });
    try {
      const provider = createFsProvider<any>({ path: join(root, 'data.json'), mode: 'file' });
      await provider.create({ id: '../x', name: 'ok' });
      expect((await provider.getOne('../x')).name).toBe('ok');
      expect(readdirSync(root)).toEqual(['data.json']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
