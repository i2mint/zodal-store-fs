/**
 * Provider descriptors for this package: each filesystem provider described as
 * data, so an app, a playground or an agent can list it in a backend menu, render
 * its options, and create it by name with `createFromDescriptor` from
 * `@zodal/store/descriptor`.
 *
 * - `descriptor` (`fs`): items as JSON files, one per item or one array file.
 * - `contentDescriptor` (`fsContent`): metadata JSON plus content sidecar files.
 * - `blobDescriptor` (`fsBlob`): content only, the content side of a bifurcation.
 *
 * None of the options is a secret or a live object: they are all plain data.
 * `create` imports its provider module lazily, so listing a descriptor loads
 * nothing but this file.
 */

import { z } from 'zod';
import { defineProviderDescriptor } from '@zodal/store/descriptor';
import type { ProviderCapabilities } from '@zodal/store';

const MODULE = '@zodal/store-fs';

const path = z.string().min(1).meta({ description: 'Directory (or, in file mode, JSON file) to store items in.' });
const idField = z.string().min(1).optional().meta({ description: "Field used as the unique identifier. Default: 'id'." });
const searchFields = z.array(z.string()).optional().meta({ description: 'Fields searched by text search. Default: every string field.' });
const contentFields = z.array(z.string()).meta({ description: 'Fields stored as separate content files.' });

/** Everything is evaluated in this process: the filesystem does no querying. */
const CLIENT_SIDE: Pick<ProviderCapabilities, 'serverSort' | 'serverFilter' | 'serverSearch' | 'serverPagination'> = {
  serverSort: false,
  serverFilter: false,
  serverSearch: false,
  serverPagination: false,
};

/** Items as JSON on the local filesystem (`createFsProvider`). */
export const descriptor = defineProviderDescriptor({
  name: 'fs',
  label: 'Filesystem (JSON)',
  description: 'Items as JSON files on the local filesystem: one file per item, or one array file.',
  source: { module: MODULE, export: 'descriptor' },
  runtime: 'node',
  options: z.object({
    path,
    mode: z.enum(['directory', 'file']).optional().meta({ description: "'directory': one {id}.json per item (default); 'file': one JSON array." }),
    idField,
    searchFields,
  }),
  capabilities: {
    canCreate: true, canUpdate: true, canDelete: true,
    canBulkUpdate: true, canBulkDelete: true, canUpsert: true,
    ...CLIENT_SIDE,
  },
  create: async (o) => (await import('./provider.js')).createFsProvider(o),
});

/**
 * Metadata JSON plus content sidecar files (`createFsContentProvider`). Already
 * metadata + content in one provider, so it is marked `composite` and is not
 * offered as a child of `bifurcatedDescriptor`.
 */
export const contentDescriptor = defineProviderDescriptor({
  name: 'fsContent',
  label: 'Filesystem (JSON + content files)',
  description: 'Metadata as {id}.json and each content field as an {id}.{field}.{ext} file beside it.',
  source: { module: MODULE, export: 'contentDescriptor' },
  runtime: 'node',
  composite: true,
  options: z.object({
    path: z.string().min(1).meta({ description: 'Directory to store metadata and content files in.' }),
    contentFields,
    idField,
    searchFields,
    listStrategy: z.enum(['reference', 'omit']).optional().meta({ description: "How content fields appear in lists. Default: 'reference'." }),
    contentExtension: z.string().min(1).optional().meta({ description: "Extension of content files. Default: 'bin'." }),
  }),
  capabilities: (o) => ({
    canCreate: true, canUpdate: true, canDelete: true,
    canBulkUpdate: true, canBulkDelete: true, canUpsert: false,
    ...CLIENT_SIDE,
    bifurcated: true,
    contentFields: o.contentFields,
  }),
  create: async (o) => (await import('./content-provider.js')).createFsContentProvider(o),
});

/** Content only, as `{path}/{id}/{field}.{ext}` files (`createFsBlobProvider`): the content side of a bifurcation. */
export const blobDescriptor = defineProviderDescriptor({
  name: 'fsBlob',
  label: 'Filesystem (content files)',
  description: 'Content fields only, as {id}/{field}.{ext} files; pair it with a metadata provider.',
  source: { module: MODULE, export: 'blobDescriptor' },
  runtime: 'node',
  options: z.object({
    path: z.string().min(1).meta({ description: 'Directory to store content files in.' }),
    contentFields,
    idField,
    extension: z.string().min(1).optional().meta({ description: "Extension of content files. Default: 'bin'." }),
  }),
  capabilities: {
    canCreate: true, canUpdate: true, canDelete: true,
    canBulkUpdate: true, canBulkDelete: true, canUpsert: false,
    ...CLIENT_SIDE,
  },
  create: async (o) => (await import('./blob-provider.js')).createFsBlobProvider(o),
});
