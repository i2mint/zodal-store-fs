/**
 * Filesystem Content-Aware Provider: Sidecar files pattern.
 *
 * Layout (directory mode):
 *   {basePath}/{id}.json              — metadata (JSON)
 *   {basePath}/{id}.{field}.bin       — content (raw binary)
 *
 * Metadata is stored as JSON, content fields are stored as separate
 * binary files alongside the metadata. This keeps the directory browsable
 * and the metadata files small and fast to parse.
 */

import { promises as fs } from 'node:fs';
import { join, basename } from 'node:path';
import type { DataProvider, GetListParams, GetListResult } from '@zodal/store';
import type { ProviderCapabilities } from '@zodal/store';
import { applyQuery, compareBinary } from '@zodal/store';

/** Content reference — matches @zodal/core ContentRef (available in >= 0.2.0). */
export interface ContentRef {
  readonly _tag: 'ContentRef';
  field: string;
  itemId: string;
  hash?: string;
  url?: string;
  mimeType?: string;
  size?: number;
}

export interface FsContentProviderOptions {
  /** Base directory path. */
  path: string;
  /** Content field names. */
  contentFields: string[];
  /** ID field. Default: 'id'. */
  idField?: string;
  /** Fields for text search. Default: all string metadata fields. */
  searchFields?: string[];
  /** How content fields appear in getList. Default: 'reference'. */
  listStrategy?: 'reference' | 'omit';
  /** File extension for content sidecar files. Default: 'bin'. */
  contentExtension?: string;
}

export function createFsContentProvider<T extends Record<string, any>>(
  options: FsContentProviderOptions,
): DataProvider<T> {
  const {
    path: basePath, contentFields, searchFields,
    listStrategy = 'reference',
    contentExtension = 'bin',
  } = options;
  const idField = options.idField ?? 'id';
  const contentSet = new Set(contentFields);
  let nextId = Date.now();

  function metaPath(id: string): string {
    return join(basePath, `${id}.json`);
  }
  async function exists(id: string): Promise<boolean> {
    try {
      await fs.access(metaPath(id));
      return true;
    } catch {
      return false;
    }
  }


  function contentPath(id: string, field: string): string {
    return join(basePath, `${id}.${field}.${contentExtension}`);
  }

  function toContentRef(id: string, field: string): ContentRef {
    return { _tag: 'ContentRef', field, itemId: id };
  }

  async function ensureDir(): Promise<void> {
    await fs.mkdir(basePath, { recursive: true });
  }

  async function readMeta(id: string): Promise<Record<string, any>> {
    const raw = await fs.readFile(metaPath(id), 'utf-8');
    return JSON.parse(raw);
  }

  async function writeMeta(id: string, meta: Record<string, any>): Promise<void> {
    await ensureDir();
    await fs.writeFile(metaPath(id), JSON.stringify(meta, null, 2));
  }

  async function readContent(id: string, field: string): Promise<Buffer> {
    return fs.readFile(contentPath(id, field));
  }

  async function writeContent(id: string, field: string, content: unknown): Promise<void> {
    await ensureDir();
    if (Buffer.isBuffer(content)) {
      await fs.writeFile(contentPath(id, field), content);
    } else if (content instanceof Uint8Array) {
      await fs.writeFile(contentPath(id, field), content);
    } else if (typeof content === 'string') {
      await fs.writeFile(contentPath(id, field), content, 'utf-8');
    } else {
      await fs.writeFile(contentPath(id, field), JSON.stringify(content));
    }
  }

  async function deleteContentFiles(id: string): Promise<void> {
    for (const field of contentFields) {
      try { await fs.unlink(contentPath(id, field)); } catch { /* may not exist */ }
    }
  }

  function splitFields(data: Record<string, any>): { meta: Record<string, any>; content: Record<string, any> } {
    const meta: Record<string, any> = {};
    const content: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      if (contentSet.has(key)) content[key] = value;
      else meta[key] = value;
    }
    return { meta, content };
  }

  function applyContentStrategy(item: Record<string, any>): Record<string, any> {
    const result = { ...item };
    for (const field of contentFields) {
      if (listStrategy === 'omit') delete result[field];
      else result[field] = toContentRef(String(item[idField]), field);
    }
    return result;
  }

  async function listAllMeta(): Promise<Record<string, any>[]> {
    await ensureDir();
    const files = await fs.readdir(basePath);
    const items: Record<string, any>[] = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const raw = await fs.readFile(join(basePath, file), 'utf-8');
          items.push(JSON.parse(raw));
        } catch { /* skip */ }
      }
    }
    return items;
  }


  return {
    async getList(params: GetListParams): Promise<GetListResult<T>> {
      // compareBinary keeps this provider's historical code-unit string order.
      const { data, total } = applyQuery(await listAllMeta(), params, {
        searchFields,
        excludeFromSearch: contentSet,
        compare: compareBinary,
      });
      return { data: data.map(applyContentStrategy) as T[], total };
    },

    async getOne(id: string): Promise<T> {
      const meta = await readMeta(id);
      return applyContentStrategy(meta) as T;
    },

    async create(data: Partial<T>): Promise<T> {
      const given = (data as any)[idField];
      if (given != null && (await exists(String(given)))) {
        throw new Error(`Item already exists: ${given}`);
      }
      let id = given != null ? String(given) : String(nextId++);
      while (given == null && (await exists(id))) id = String(nextId++);
      const withId = { ...data, [idField]: id };
      const { meta, content } = splitFields(withId as Record<string, any>);

      await writeMeta(id, meta);
      for (const [field, value] of Object.entries(content)) {
        await writeContent(id, field, value);
      }

      return meta as T;
    },

    async update(id: string, data: Partial<T>): Promise<T> {
      const { meta, content } = splitFields(data as Record<string, any>);

      let result: Record<string, any>;
      if (Object.keys(meta).length > 0) {
        const existing = await readMeta(id);
        result = { ...existing, ...meta };
        await writeMeta(id, result);
      } else {
        result = await readMeta(id);
      }

      for (const [field, value] of Object.entries(content)) {
        await writeContent(id, field, value);
      }

      return result as T;
    },

    async updateMany(ids: string[], data: Partial<T>): Promise<T[]> {
      // Ids with no item are skipped (the DataProvider contract).
      const updated: T[] = [];
      for (const id of ids) {
        if (await exists(id)) updated.push(await this.update(id, data));
      }
      return updated;
    },

    async delete(id: string): Promise<void> {
      await deleteContentFiles(id);
      await fs.unlink(metaPath(id));
    },

    async deleteMany(ids: string[]): Promise<void> {
      // Ids with no item are skipped (the DataProvider contract).
      for (const id of ids) {
        if (await exists(id)) await this.delete(id);
      }
    },

    getCapabilities(): ProviderCapabilities {
      return {
        canCreate: true, canUpdate: true, canDelete: true,
        canBulkUpdate: true, canBulkDelete: true, canUpsert: false,
        serverSort: false, serverFilter: false, serverSearch: false, serverPagination: false,
        // bifurcated + contentFields available when @zodal/store >= 0.2.0
        ...({ bifurcated: true, contentFields } as any),
      };
    },

    // getContent/setContent: available when @zodal/store >= 0.2.0 types are installed
    async getContent(id: string, field: string): Promise<Buffer> {
      if (!contentSet.has(field)) throw new Error(`'${field}' is not a content field`);
      return readContent(id, field);
    },

    async setContent(id: string, field: string, content: unknown): Promise<ContentRef> {
      if (!contentSet.has(field)) throw new Error(`'${field}' is not a content field`);
      await writeContent(id, field, content);
      return toContentRef(id, field);
    },
  } as DataProvider<T>;
}
