import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFsBlobProvider } from '../src/blob-provider.js';

function tempDir(): string {
  const dir = join(tmpdir(), `zodal-blob-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('createFsBlobProvider', () => {
  let testPath: string;
  let provider: ReturnType<typeof createFsBlobProvider>;

  beforeEach(() => {
    testPath = tempDir();
    provider = createFsBlobProvider({
      path: testPath,
      contentFields: ['attachment', 'thumbnail'],
    });
  });

  afterEach(() => {
    if (existsSync(testPath)) {
      rmSync(testPath, { recursive: true, force: true });
    }
  });

  it('creates and retrieves content', async () => {
    await provider.create({ id: '1', attachment: Buffer.from('hello world') } as any);

    const result = await provider.getOne('1');
    const content = (result as any).attachment as Buffer;
    expect(content.toString()).toBe('hello world');
  });

  it('stores blobs at correct filesystem paths', async () => {
    await provider.create({ id: 'doc-1', attachment: Buffer.from('data') } as any);
    const expectedPath = join(testPath, 'doc-1', 'attachment.bin');
    expect(existsSync(expectedPath)).toBe(true);
    expect(readFileSync(expectedPath).toString()).toBe('data');
  });

  it('handles multiple content fields', async () => {
    await provider.create({
      id: '1',
      attachment: Buffer.from('attach'),
      thumbnail: Buffer.from('thumb'),
    } as any);

    const result = await provider.getOne('1');
    expect((result as any).attachment.toString()).toBe('attach');
    expect((result as any).thumbnail.toString()).toBe('thumb');
  });

  it('updates a single content field', async () => {
    await provider.create({ id: '1', attachment: Buffer.from('original') } as any);
    await provider.update('1', { attachment: Buffer.from('updated') } as any);

    const result = await provider.getOne('1');
    expect((result as any).attachment.toString()).toBe('updated');
  });

  it('deletes all content for an id', async () => {
    await provider.create({
      id: '1',
      attachment: Buffer.from('data'),
      thumbnail: Buffer.from('img'),
    } as any);
    await provider.delete('1');

    expect(existsSync(join(testPath, '1', 'attachment.bin'))).toBe(false);
    expect(existsSync(join(testPath, '1', 'thumbnail.bin'))).toBe(false);
  });

  it('getList returns empty (content-only provider)', async () => {
    await provider.create({ id: '1', attachment: Buffer.from('data') } as any);
    const { data, total } = await provider.getList({});
    expect(data).toHaveLength(0);
    expect(total).toBe(0);
  });

  it('ignores non-content fields in create', async () => {
    await provider.create({ id: '1', attachment: Buffer.from('data'), title: 'ignored' } as any);
    expect(existsSync(join(testPath, '1', 'attachment.bin'))).toBe(true);
    expect(existsSync(join(testPath, '1', 'title.bin'))).toBe(false);
  });

  it('getOne returns id even when content is missing', async () => {
    const result = await provider.getOne('nonexistent');
    expect((result as any).id).toBe('nonexistent');
    expect((result as any).attachment).toBeUndefined();
  });

  it('stores string content as UTF-8', async () => {
    await provider.create({ id: '1', attachment: 'hello utf-8' } as any);
    const filePath = join(testPath, '1', 'attachment.bin');
    expect(readFileSync(filePath, 'utf-8')).toBe('hello utf-8');
  });

  it('stores JSON-serializable content as JSON string', async () => {
    await provider.create({ id: '1', attachment: { key: 'value' } } as any);
    const filePath = join(testPath, '1', 'attachment.bin');
    expect(readFileSync(filePath, 'utf-8')).toBe('{"key":"value"}');
  });

  it('custom extension', async () => {
    const customProvider = createFsBlobProvider({
      path: testPath,
      contentFields: ['attachment'],
      extension: 'dat',
    });
    await customProvider.create({ id: '1', attachment: Buffer.from('data') } as any);
    expect(existsSync(join(testPath, '1', 'attachment.dat'))).toBe(true);
  });

  it('updateMany updates multiple items', async () => {
    await provider.create({ id: '1', attachment: Buffer.from('a') } as any);
    await provider.create({ id: '2', attachment: Buffer.from('b') } as any);
    await provider.updateMany(['1', '2'], { attachment: Buffer.from('updated') } as any);

    const r1 = await provider.getOne('1');
    const r2 = await provider.getOne('2');
    expect((r1 as any).attachment.toString()).toBe('updated');
    expect((r2 as any).attachment.toString()).toBe('updated');
  });

  it('deleteMany removes multiple items', async () => {
    await provider.create({ id: '1', attachment: Buffer.from('a') } as any);
    await provider.create({ id: '2', attachment: Buffer.from('b') } as any);
    await provider.deleteMany(['1', '2']);
    expect(existsSync(join(testPath, '1', 'attachment.bin'))).toBe(false);
    expect(existsSync(join(testPath, '2', 'attachment.bin'))).toBe(false);
  });

  it('reports capabilities correctly', () => {
    const caps = provider.getCapabilities!();
    expect(caps.canCreate).toBe(true);
    expect(caps.canUpdate).toBe(true);
    expect(caps.canDelete).toBe(true);
    expect(caps.serverSort).toBe(false);
  });
});
