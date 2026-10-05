/**
 * The provider descriptors: created by name through `createFromDescriptor`, the
 * providers they build pass the `@zodal/store/testing` contract; bad options fail
 * with a structural error naming the descriptor; no option is secret or live; and
 * what a menu shows as capabilities is what the created provider reports.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createFromDescriptor,
  defineProviderDescriptor,
  describedCapabilities,
  isProviderSupported,
  liveOptionPaths,
  redactOptions,
  secretOptionPaths,
  bifurcatedDescriptor,
  type ProviderDescriptor,
} from '@zodal/store/descriptor';
import { providerContract, type ContractRow } from '@zodal/store/testing';
import type { DataProvider } from '@zodal/store';
import { descriptor, contentDescriptor, blobDescriptor } from '../src/index.js';

const scratch = mkdtempSync(join(tmpdir(), 'zodal-store-fs-descriptor-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let counter = 0;
const freshDir = () => join(scratch, `case-${++counter}`);

const all: [string, ProviderDescriptor, (dir: string) => Record<string, unknown>][] = [
  ['descriptor (directory mode)', descriptor, (dir) => ({ path: dir })],
  ['descriptor (file mode)', descriptor, (dir) => ({ path: `${dir}.json`, mode: 'file' })],
  ['contentDescriptor', contentDescriptor, (dir) => ({ path: dir, contentFields: ['body'] })],
  ['blobDescriptor', blobDescriptor, (dir) => ({ path: dir, contentFields: ['body'] })],
];

// The contract, run through the descriptor path (validation, then lazy create).
for (const [label, d, options] of all.slice(0, 3)) {
  const opts = (dir: string) => (d === contentDescriptor ? { ...options(dir), contentFields: [] } : options(dir));
  const cases = await providerContract({
    make: async (seed) => {
      const provider = (await createFromDescriptor(d, opts(freshDir()))) as DataProvider<ContractRow>;
      for (const row of seed) await provider.create(row);
      return provider;
    },
  });
  describe(`fs ${label} via createFromDescriptor: DataProvider contract`, () => {
    for (const c of cases) (c.skip ? it.skip : it)(c.name, c.run);
  });
}

describe('fs provider descriptors', () => {
  it('are accepted by defineProviderDescriptor, with distinct names and their own source', () => {
    for (const [, d] of all) expect(defineProviderDescriptor(d)).toBe(d);
    expect(new Set([descriptor, contentDescriptor, blobDescriptor].map((d) => d.name))).toEqual(new Set(['fs', 'fsContent', 'fsBlob']));
    expect(descriptor.source).toEqual({ module: '@zodal/store-fs', export: 'descriptor' });
    expect(contentDescriptor.source.export).toBe('contentDescriptor');
    expect(blobDescriptor.source.export).toBe('blobDescriptor');
  });

  it('run in node only, and are supported here', async () => {
    for (const [, d] of all) {
      expect(d.runtime).toBe('node');
      expect(await isProviderSupported(d)).toBe(true);
      expect(await isProviderSupported(d, 'browser')).toBe(false);
    }
  });

  it('create a working provider from valid options', async () => {
    const provider = await createFromDescriptor(descriptor, { path: freshDir(), idField: 'key', searchFields: ['name'] });
    await provider.create({ key: 'a', name: 'Alpha' });
    expect(await provider.getOne('a')).toEqual({ key: 'a', name: 'Alpha' });
    expect((await provider.getList({ search: 'alp' })).total).toBe(1);
  });

  it('reject invalid options with a structural error naming the descriptor', async () => {
    await expect(createFromDescriptor(descriptor, {})).rejects.toThrow(/Invalid options for provider "fs": path: invalid_type/);
    await expect(createFromDescriptor(descriptor, { path: freshDir(), mode: 'sqlite' })).rejects.toThrow(/provider "fs": mode: invalid_value/);
    await expect(createFromDescriptor(contentDescriptor, { path: freshDir() })).rejects.toThrow(/provider "fsContent": contentFields/);
    await expect(createFromDescriptor(blobDescriptor, { path: '', contentFields: [] })).rejects.toThrow(/provider "fsBlob": path: too_small/);
  });

  it('have no secret and no live option: options are plain, shareable data', () => {
    for (const [, d, options] of all) {
      expect(secretOptionPaths(d)).toEqual([]);
      expect(liveOptionPaths(d)).toEqual([]);
      const o = options('/data/items');
      expect(redactOptions(d, o)).toEqual(o);
    }
  });

  it('describe the capabilities the created provider reports', async () => {
    for (const [, d, options] of all) {
      const o = options(freshDir());
      const provider = await createFromDescriptor(d, o);
      expect(provider.getCapabilities!()).toMatchObject(describedCapabilities(d, o as any));
    }
    expect(describedCapabilities(contentDescriptor, { path: 'x', contentFields: ['body'] })).toMatchObject({ bifurcated: true, contentFields: ['body'] });
  });

  it('compose under bifurcatedDescriptor (fs metadata, fs blobs); the content provider is not a child', async () => {
    const bifurcated = bifurcatedDescriptor([descriptor, contentDescriptor, blobDescriptor]);
    const dir = freshDir();
    await expect(
      createFromDescriptor(bifurcated, {
        metadata: { name: 'fsContent', options: { path: dir, contentFields: [] } },
        content: { name: 'fsBlob', options: { path: dir, contentFields: ['body'] } },
        contentFields: ['body'],
      }),
    ).rejects.toThrow(/Invalid options for provider "bifurcated"/);

    const provider = await createFromDescriptor(bifurcated, {
      metadata: { name: 'fs', options: { path: join(dir, 'meta') } },
      content: { name: 'fsBlob', options: { path: join(dir, 'blobs'), contentFields: ['body'] } },
      contentFields: ['body'],
      detailStrategy: 'eager',
    });
    await provider.create({ id: 'n1', title: 'Note', body: 'hello' });
    expect((await provider.getList({})).data.map((r: any) => r.title)).toEqual(['Note']);
    expect(String(await provider.getContent!('n1', 'body'))).toBe('hello');
  });
});
