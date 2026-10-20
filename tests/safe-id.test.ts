import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
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

  it('checks the same string it returns, even for a shape-shifting non-string id', () => {
    let calls = 0;
    const id = { toString: () => (calls++ ? '../victim' : 'ok') };
    expect(assertSafeId(id)).toBe('ok');
    expect(() => assertSafeId(['..'])).toThrow(/Unsafe id/);
  });
});

type Factory = (storePath: string) => DataProvider<any>;

const providers: [string, Factory][] = [
  ['createFsProvider (directory)', (path) => createFsProvider({ path, mode: 'directory' })],
  ['createFsContentProvider', (path) => createFsContentProvider({ path, contentFields: ['body'] })],
  ['createFsBlobProvider', (path) => createFsBlobProvider({ path, contentFields: ['body'] })],
];

describe.each(providers)('%s: ids cannot escape the store', (_name, factory) => {
  // Layout: {root}/store is the store; {root}/victim.json, {root}/victim.body.bin and
  // {root}/victim/ sit outside it, one target per way a provider maps an id to a path.
  let root: string;
  let provider: DataProvider<any>;

  beforeEach(() => {
    root = join(tmpdir(), `zodal-fs-safe-id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(root, 'store'), { recursive: true });
    writeFileSync(join(root, 'victim.json'), JSON.stringify({ id: 'victim', secret: true }));
    writeFileSync(join(root, 'victim.body.bin'), 'secret');
    mkdirSync(join(root, 'victim'));
    writeFileSync(join(root, 'victim', 'body.bin'), 'secret');
    provider = factory(join(root, 'store'));
  });

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  function outsideUntouched(): void {
    expect(readdirSync(root).sort()).toEqual(['store', 'victim', 'victim.body.bin', 'victim.json']);
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

  it('updateMany rejects a traversing id and writes nothing outside', async () => {
    await expect(provider.updateMany!(['../victim'], { name: 'x', body: 'x' })).rejects.toThrow(/Unsafe id/);
    outsideUntouched();
  });

  it('a batch with one unsafe id touches nothing, inside or outside', async () => {
    await provider.create({ id: 'a', name: 'a', body: 'a' });
    await provider.create({ id: 'b', name: 'b', body: 'b' });
    const before = readdirSync(join(root, 'store')).sort();
    await expect(provider.deleteMany!(['a', '../victim', 'b'])).rejects.toThrow(/Unsafe id/);
    await expect(provider.updateMany!(['a', '../victim', 'b'], { name: 'x' })).rejects.toThrow(/Unsafe id/);
    expect(readdirSync(join(root, 'store')).sort()).toEqual(before);
    expect((await provider.getOne('a')).id).toBe('a');
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

describe('createFsContentProvider: content accessors cannot escape the store', () => {
  let root: string;
  let provider: any;

  beforeEach(() => {
    root = join(tmpdir(), `zodal-fs-safe-id-content-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(root, 'store'), { recursive: true });
    writeFileSync(join(root, 'victim.body.bin'), 'secret');
    provider = createFsContentProvider({ path: join(root, 'store'), contentFields: ['body'] });
  });

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it('getContent rejects a traversing id', async () => {
    await expect(provider.getContent('../victim', 'body')).rejects.toThrow(/Unsafe id/);
  });

  it('setContent rejects a traversing id and writes nothing outside', async () => {
    await expect(provider.setContent('../victim', 'body', 'overwritten')).rejects.toThrow(/Unsafe id/);
    await expect(provider.setContent('../evil', 'body', 'x')).rejects.toThrow(/Unsafe id/);
    expect(readdirSync(root).sort()).toEqual(['store', 'victim.body.bin']);
    expect(readFileSync(join(root, 'victim.body.bin'), 'utf-8')).toBe('secret');
  });
});

describe("ids: 'portable' (#6)", () => {
  it.each(['abc', '123', 'a.b', 'my-item_2', '.hidden', 'console', 'nul-x', 'com10'])('accepts %j', (id) => {
    expect(assertSafeId(id, 'portable')).toBe(id);
  });

  it.each(['A', 'Abc', 'é', 'with space', 'a:b', 'trailing.', 'con', 'NUL', 'nul.txt', 'com1', 'lpt9.log', 'aux'])(
    'rejects %j',
    (id) => {
      expect(() => assertSafeId(id, 'portable')).toThrow(/Non-portable id/);
    },
  );

  it('still rejects unsafe ids first', () => {
    expect(() => assertSafeId('../x', 'portable')).toThrow(/Unsafe id/);
  });

  it('is enforced by every provider, and off by default', async () => {
    const dir = join(tmpdir(), `zodal-store-fs-portable-${process.pid}-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    try {
      const strict = [
        createFsProvider({ path: join(dir, 'p'), ids: 'portable' }),
        createFsContentProvider({ path: join(dir, 'c'), contentFields: ['body'], ids: 'portable' }),
        createFsBlobProvider({ path: join(dir, 'b'), contentFields: ['body'], ids: 'portable' }),
      ] as DataProvider<any>[];
      for (const p of strict) await expect(p.getOne('Item')).rejects.toThrow(/Non-portable id/);
      const lax = createFsProvider({ path: join(dir, 'l') });
      await expect(lax.create({ id: 'Item', name: 'x' })).resolves.toMatchObject({ id: 'Item' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("ids: 'portable', review follow-ups (#6)", () => {
  it('caps the id length', () => {
    expect(assertSafeId('a'.repeat(200), 'portable')).toHaveLength(200);
    expect(() => assertSafeId('a'.repeat(201), 'portable')).toThrow(/Non-portable id/);
  });

  it('requires lowercase content field names and extensions', () => {
    const dir = join(tmpdir(), 'zodal-store-fs-never-created');
    expect(() => createFsContentProvider({ path: dir, contentFields: ['Body'], ids: 'portable' })).toThrow(/lowercase/);
    expect(() => createFsContentProvider({ path: dir, contentFields: ['body'], contentExtension: 'BIN', ids: 'portable' })).toThrow(/lowercase/);
    expect(() => createFsBlobProvider({ path: dir, contentFields: ['Body'], ids: 'portable' })).toThrow(/lowercase/);
    expect(() => createFsContentProvider({ path: dir, contentFields: ['Body'] })).not.toThrow();
  });
});
