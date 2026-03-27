import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFsProvider } from '../src/index.js';

interface TestItem {
  id: string;
  name: string;
  priority: number;
}

function tempDir(): string {
  const dir = join(tmpdir(), `zodal-fs-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe.each(['directory', 'file'] as const)('createFsProvider (mode: %s)', (mode) => {
  let testPath: string;
  let provider: ReturnType<typeof createFsProvider<TestItem>>;

  beforeEach(() => {
    if (mode === 'directory') {
      testPath = tempDir();
      provider = createFsProvider<TestItem>({ path: testPath, mode: 'directory' });
    } else {
      testPath = join(tempDir(), 'data.json');
      provider = createFsProvider<TestItem>({ path: testPath, mode: 'file' });
    }
  });

  afterEach(() => {
    const dir = mode === 'directory' ? testPath : join(testPath, '..');
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates and retrieves an item', async () => {
    const created = await provider.create({ name: 'Alpha', priority: 1 });
    expect(created).toHaveProperty('id');
    const fetched = await provider.getOne(created.id);
    expect(fetched.name).toBe('Alpha');
  });

  it('lists all items', async () => {
    await provider.create({ name: 'A', priority: 1 });
    await provider.create({ name: 'B', priority: 2 });
    const { data, total } = await provider.getList({});
    expect(data).toHaveLength(2);
    expect(total).toBe(2);
  });

  it('updates an item', async () => {
    const created = await provider.create({ name: 'Before', priority: 1 });
    const updated = await provider.update(created.id, { name: 'After' });
    expect(updated.name).toBe('After');
  });

  it('deletes an item', async () => {
    const created = await provider.create({ name: 'Doomed', priority: 1 });
    await provider.delete(created.id);
    await expect(provider.getOne(created.id)).rejects.toThrow('Item not found');
  });

  it('filters with FilterExpression', async () => {
    await provider.create({ name: 'Low', priority: 1 });
    await provider.create({ name: 'High', priority: 5 });
    const { data } = await provider.getList({
      filter: { field: 'priority', operator: 'gte', value: 3 },
    });
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('High');
  });

  it('sorts results', async () => {
    await provider.create({ name: 'Zebra', priority: 1 });
    await provider.create({ name: 'Alpha', priority: 2 });
    const { data } = await provider.getList({
      sort: [{ id: 'name', desc: false }],
    });
    expect(data[0].name).toBe('Alpha');
  });

  it('paginates results', async () => {
    for (let i = 0; i < 15; i++) {
      await provider.create({ name: `Item ${i}`, priority: i });
    }
    const { data, total } = await provider.getList({
      pagination: { page: 2, pageSize: 10 },
    });
    expect(data).toHaveLength(5);
    expect(total).toBe(15);
  });

  it('upserts', async () => {
    await provider.upsert!({ id: 'u1', name: 'V1', priority: 1 });
    await provider.upsert!({ id: 'u1', name: 'V2', priority: 2 });
    const { data } = await provider.getList({});
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('V2');
  });

  it('reports capabilities', () => {
    const caps = provider.getCapabilities!();
    expect(caps.canCreate).toBe(true);
    expect(caps.serverSort).toBe(false);
  });

  it('throws on getOne for missing item', async () => {
    await expect(provider.getOne('nonexistent')).rejects.toThrow('Item not found');
  });

  it('updateMany updates multiple items', async () => {
    const a = await provider.create({ name: 'A', priority: 1 });
    const b = await provider.create({ name: 'B', priority: 2 });
    const updated = await provider.updateMany([a.id, b.id], { priority: 99 });
    expect(updated).toHaveLength(2);
    expect(updated[0].priority).toBe(99);
    expect(updated[1].priority).toBe(99);
  });

  it('deleteMany removes multiple items', async () => {
    const a = await provider.create({ name: 'A', priority: 1 });
    const b = await provider.create({ name: 'B', priority: 2 });
    await provider.create({ name: 'C', priority: 3 });
    await provider.deleteMany([a.id, b.id]);
    const { data, total } = await provider.getList({});
    expect(total).toBe(1);
    expect(data[0].name).toBe('C');
  });

  it('searches text fields', async () => {
    await provider.create({ name: 'Hello World', priority: 1 });
    await provider.create({ name: 'Goodbye Moon', priority: 2 });
    const { data } = await provider.getList({ search: 'hello' });
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe('Hello World');
  });
});
