/**
 * The DataProvider contract from `@zodal/store/testing`, run against every
 * storage shape this package offers. Each case gets a fresh temp directory.
 */

import { describe, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerContract, type ContractRow } from '@zodal/store/testing';
import type { DataProvider } from '@zodal/store';
import { createFsProvider } from '../src/provider.js';
import { createFsContentProvider } from '../src/content-provider.js';

const roots = new WeakMap<object, string>();

async function seeded(
  build: (root: string) => DataProvider<ContractRow>,
  seed: ContractRow[],
): Promise<DataProvider<ContractRow>> {
  const root = mkdtempSync(join(tmpdir(), 'zodal-store-fs-contract-'));
  const provider = build(root);
  for (const row of seed) await provider.create(row);
  roots.set(provider, root);
  return provider;
}

const dispose = (provider: DataProvider<ContractRow>) => {
  const root = roots.get(provider);
  if (root) rmSync(root, { recursive: true, force: true });
};

const shapes: [string, (root: string) => DataProvider<ContractRow>][] = [
  ['directory mode', (root) => createFsProvider<ContractRow>({ path: join(root, 'items') })],
  ['file mode', (root) => createFsProvider<ContractRow>({ path: join(root, 'items.json'), mode: 'file' })],
  ['content provider (no content fields)', (root) => createFsContentProvider<ContractRow>({ path: root, contentFields: [] })],
];

for (const [label, build] of shapes) {
  const cases = await providerContract({ make: (seed) => seeded(build, seed), dispose });
  describe(`fs ${label}: DataProvider contract`, () => {
    for (const c of cases) (c.skip ? it.skip : it)(c.name, c.run);
  });
}
