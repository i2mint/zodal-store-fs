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
import type { DataProvider, GetListParams, GetListResult, ProviderCapabilities } from '@zodal/store';
import { applyQuery } from '@zodal/store';

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

  function exists(id: string): boolean {
    if (mode === 'directory') return existsSync(join(storagePath, `${id}.json`));
    return readAllItems().some(i => getItemId(i) === id);
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
      // Items are parsed fresh from disk on every call, so they are already copies.
      return applyQuery(readAllItems(), params, { searchFields });
    },

    async getOne(id: string): Promise<T> {
      return getOneItem(id);
    },

    async create(data: Partial<T>): Promise<T> {
      const given = (data as any)[idField];
      if (given != null && exists(String(given))) {
        throw new Error(`Item already exists: ${given}`);
      }
      let id = given;
      if (id == null) {
        do id = String(nextId++); while (exists(id));
      }
      const newItem = { ...data, [idField]: id } as T;
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
