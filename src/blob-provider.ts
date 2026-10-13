/**
 * Filesystem Blob Provider: Pure content-only storage for cross-backend bifurcation.
 *
 * Stores each content field as a raw file at:
 *   {path}/{id}/{field}.{extension}
 *
 * Designed to be used as the `contentProvider` argument to
 * `createBifurcatedProvider()` from @zodal/store, paired with any
 * metadata provider (Supabase, in-memory, etc.).
 *
 * @example
 * ```typescript
 * import { createBifurcatedProvider } from '@zodal/store';
 * import { createSupabaseProvider } from '@zodal/store-supabase';
 * import { createFsBlobProvider } from '@zodal/store-fs';
 *
 * const provider = createBifurcatedProvider({
 *   metadataProvider: createSupabaseProvider({ client: supabase, table: 'docs' }),
 *   contentProvider: createFsBlobProvider({
 *     path: '/data/blobs',
 *     contentFields: ['attachment'],
 *   }),
 *   contentFields: ['attachment'],
 * });
 * ```
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { DataProvider, GetListParams, GetListResult } from '@zodal/store';
import type { ProviderCapabilities } from '@zodal/store';
import { assertSafeId, assertSafeIds } from './safe-id.js';

export interface FsBlobProviderOptions {
  /** Base directory for blob storage. */
  path: string;
  /** Content field names this provider manages. */
  contentFields: string[];
  /** Field used as unique identifier. Default: 'id'. */
  idField?: string;
  /** File extension for blob files. Default: 'bin'. */
  extension?: string;
}

export function createFsBlobProvider<T extends Record<string, any>>(
  options: FsBlobProviderOptions,
): DataProvider<T> {
  const { path: basePath, contentFields } = options;
  const idField = options.idField ?? 'id';
  const extension = options.extension ?? 'bin';
  const contentSet = new Set(contentFields);

  /** The directory holding item `id`'s blobs. Throws on an id that could escape the store. */
  function blobDir(id: string): string {
    return join(basePath, assertSafeId(id));
  }

  function blobPath(id: string, field: string): string {
    return join(blobDir(id), `${field}.${extension}`);
  }

  async function ensureDir(id: string): Promise<void> {
    await fs.mkdir(blobDir(id), { recursive: true });
  }

  async function putBlob(id: string, field: string, content: unknown): Promise<void> {
    await ensureDir(id);
    if (Buffer.isBuffer(content)) {
      await fs.writeFile(blobPath(id, field), content);
    } else if (content instanceof Uint8Array) {
      await fs.writeFile(blobPath(id, field), content);
    } else if (typeof content === 'string') {
      await fs.writeFile(blobPath(id, field), content, 'utf-8');
    } else {
      await fs.writeFile(blobPath(id, field), JSON.stringify(content));
    }
  }

  async function getBlob(id: string, field: string): Promise<Buffer> {
    return fs.readFile(blobPath(id, field));
  }

  async function deleteBlobs(id: string): Promise<void> {
    assertSafeId(id); // before the best-effort unlinks below, which swallow errors
    for (const field of contentFields) {
      try { await fs.unlink(blobPath(id, field)); } catch { /* may not exist */ }
    }
    // Try to remove the directory (will fail if not empty, which is fine)
    try { await fs.rmdir(blobDir(id)); } catch { /* may have other files */ }
  }

  return {
    async getList(): Promise<GetListResult<T>> {
      // Content-only provider — metadata provider handles listing
      return { data: [], total: 0 };
    },

    async getOne(id: string): Promise<T> {
      assertSafeId(id); // before the per-field reads below, which swallow errors
      const result: Record<string, any> = { [idField]: id };
      for (const field of contentFields) {
        try {
          result[field] = await getBlob(id, field);
        } catch {
          // Field may not have been stored yet
        }
      }
      return result as T;
    },

    async create(data: Partial<T>): Promise<T> {
      const id = String((data as any)[idField]);
      for (const [key, value] of Object.entries(data as Record<string, any>)) {
        if (contentSet.has(key) && value !== undefined) {
          await putBlob(id, key, value);
        }
      }
      return { [idField]: id } as T;
    },

    async update(id: string, data: Partial<T>): Promise<T> {
      for (const [key, value] of Object.entries(data as Record<string, any>)) {
        if (contentSet.has(key) && value !== undefined) {
          await putBlob(id, key, value);
        }
      }
      return { [idField]: id } as T;
    },

    async updateMany(ids: string[], data: Partial<T>): Promise<T[]> {
      assertSafeIds(ids);
      return Promise.all(ids.map(id => this.update(id, data)));
    },

    async delete(id: string): Promise<void> {
      await deleteBlobs(id);
    },

    async deleteMany(ids: string[]): Promise<void> {
      assertSafeIds(ids);
      await Promise.all(ids.map(id => this.delete(id)));
    },

    getCapabilities(): ProviderCapabilities {
      return {
        canCreate: true,
        canUpdate: true,
        canDelete: true,
        canBulkUpdate: true,
        canBulkDelete: true,
        canUpsert: false,
        serverSort: false,
        serverFilter: false,
        serverSearch: false,
        serverPagination: false,
      };
    },
  };
}
