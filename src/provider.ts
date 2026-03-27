/**
 * Filesystem DataProvider for zodal.
 *
 * Two storage modes:
 * - 'directory': Each item is a separate JSON file ({id}.json) in a folder
 * - 'file': All items in a single JSON array file
 *
 * All query operations are client-side.
 */

import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SortingState, FilterExpression } from '@zodal/core';
import type { DataProvider, GetListParams, GetListResult, ProviderCapabilities } from '@zodal/store';
import { filterToFunction } from '@zodal/store';

export interface FsProviderOptions {
  /**
   * Path to the storage location.
   * - In 'directory' mode: path to a directory where each item is a JSON file.
   * - In 'file' mode: path to a single JSON file containing an array.
   */
  path: string;
  /** Storage mode. Default: 'directory'. */
  mode?: 'directory' | 'file';
  /** Field name used as the unique identifier. Default: 'id'. */
  idField?: string;
  /** Fields to include in text search. Default: all string-valued fields. */
  searchFields?: string[];
}

export function createFsProvider<T extends Record<string, any>>(
  options: FsProviderOptions,
): DataProvider<T> {
  const { path: storagePath, searchFields } = options;
  const mode = options.mode ?? 'directory';
  const idField = options.idField ?? 'id';
  let nextId = Date.now();

  // Ensure storage location exists
  if (mode === 'directory') {
    if (!existsSync(storagePath)) {
      mkdirSync(storagePath, { recursive: true });
    }
  } else {
    if (!existsSync(storagePath)) {
      writeFileSync(storagePath, '[]', 'utf-8');
    }
  }

  // --- Storage helpers ---

  function readAllItems(): T[] {
    if (mode === 'file') {
      try {
        const raw = readFileSync(storagePath, 'utf-8');
        return JSON.parse(raw);
      } catch {
        return [];
      }
    }
    // directory mode
    const files = readdirSync(storagePath).filter(f => f.endsWith('.json'));
    return files.map(f => {
      const raw = readFileSync(join(storagePath, f), 'utf-8');
      return JSON.parse(raw) as T;
    });
  }

  function writeItem(item: T): void {
    if (mode === 'file') {
      const items = readAllItems();
      const id = getItemId(item);
      const index = items.findIndex(i => getItemId(i) === id);
      if (index === -1) {
        items.push(item);
      } else {
        items[index] = item;
      }
      writeFileSync(storagePath, JSON.stringify(items, null, 2), 'utf-8');
      return;
    }
    // directory mode
    const id = getItemId(item);
    writeFileSync(join(storagePath, `${id}.json`), JSON.stringify(item, null, 2), 'utf-8');
  }

  function removeItem(id: string): void {
    if (mode === 'file') {
      const items = readAllItems().filter(i => getItemId(i) !== id);
      writeFileSync(storagePath, JSON.stringify(items, null, 2), 'utf-8');
      return;
    }
    // directory mode
    const filePath = join(storagePath, `${id}.json`);
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  }

  function getItemId(item: T): string {
    return String((item as any)[idField]);
  }

  function matchesSearch(item: T, search: string): boolean {
    if (!search) return true;
    const lowerSearch = search.toLowerCase();
    const fields = searchFields ?? Object.keys(item).filter(k => typeof (item as any)[k] === 'string');
    return fields.some(field => {
      const val = (item as any)[field];
      return typeof val === 'string' && val.toLowerCase().includes(lowerSearch);
    });
  }

  function compareValues(a: any, b: any): number {
    if (a === b) return 0;
    if (a == null) return -1;
    if (b == null) return 1;
    if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
    return a < b ? -1 : 1;
  }

  // --- Local getOne to avoid `this` issues ---

  async function getOneItem(id: string): Promise<T> {
    if (mode === 'directory') {
      const filePath = join(storagePath, `${id}.json`);
      if (!existsSync(filePath)) throw new Error(`Item not found: ${id}`);
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    }
    const items = readAllItems();
    const item = items.find(i => getItemId(i) === id);
    if (!item) throw new Error(`Item not found: ${id}`);
    return { ...item };
  }

  // --- DataProvider implementation ---

  return {
    async getList(params: GetListParams): Promise<GetListResult<T>> {
      let items = readAllItems();

      if (params.filter) {
        const predicate = filterToFunction<T>(params.filter);
        items = items.filter(predicate);
      }

      if (params.search) {
        items = items.filter(item => matchesSearch(item, params.search!));
      }

      const total = items.length;

      if (params.sort && params.sort.length > 0) {
        items.sort((a, b) => {
          for (const s of params.sort!) {
            const cmp = compareValues((a as any)[s.id], (b as any)[s.id]);
            if (cmp !== 0) return s.desc ? -cmp : cmp;
          }
          return 0;
        });
      }

      if (params.pagination) {
        const { page, pageSize } = params.pagination;
        const start = (page - 1) * pageSize;
        items = items.slice(start, start + pageSize);
      }

      return { data: items, total };
    },

    async getOne(id: string): Promise<T> {
      return getOneItem(id);
    },

    async create(data: Partial<T>): Promise<T> {
      const newItem = {
        ...data,
        [idField]: (data as any)[idField] ?? String(nextId++),
      } as T;
      writeItem(newItem);
      return { ...newItem };
    },

    async update(id: string, data: Partial<T>): Promise<T> {
      const existing = await getOneItem(id);
      const updated = { ...existing, ...data };
      writeItem(updated);
      return { ...updated };
    },

    async updateMany(ids: string[], data: Partial<T>): Promise<T[]> {
      const updated: T[] = [];
      for (const id of ids) {
        try {
          const existing = await getOneItem(id);
          const item = { ...existing, ...data };
          writeItem(item);
          updated.push({ ...item });
        } catch {
          // skip missing items
        }
      }
      return updated;
    },

    async delete(id: string): Promise<void> {
      // Verify exists
      if (mode === 'directory') {
        const filePath = join(storagePath, `${id}.json`);
        if (!existsSync(filePath)) throw new Error(`Item not found: ${id}`);
      } else {
        const items = readAllItems();
        if (!items.find(i => getItemId(i) === id)) throw new Error(`Item not found: ${id}`);
      }
      removeItem(id);
    },

    async deleteMany(ids: string[]): Promise<void> {
      if (mode === 'file') {
        // Batch operation for file mode: read once, filter, write once
        const items = readAllItems();
        const idSet = new Set(ids);
        const remaining = items.filter(i => !idSet.has(getItemId(i)));
        writeFileSync(storagePath, JSON.stringify(remaining, null, 2), 'utf-8');
        return;
      }
      for (const id of ids) {
        removeItem(id);
      }
    },

    async upsert(data: T): Promise<T> {
      const item = { ...data };
      writeItem(item);
      return { ...item };
    },

    getCapabilities(): ProviderCapabilities {
      return {
        canCreate: true,
        canUpdate: true,
        canDelete: true,
        canBulkUpdate: true,
        canBulkDelete: true,
        canUpsert: true,
        serverSort: false,
        serverFilter: false,
        serverSearch: false,
        serverPagination: false,
      };
    },
  };
}
