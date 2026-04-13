export { createFsProvider } from './provider.js';
export type { FsProviderOptions } from './provider.js';

// Content-aware provider (sidecar files: metadata JSON + content binaries)
export { createFsContentProvider } from './content-provider.js';
export type { FsContentProviderOptions } from './content-provider.js';

// Blob-only provider for cross-backend bifurcation
export { createFsBlobProvider } from './blob-provider.js';
export type { FsBlobProviderOptions } from './blob-provider.js';
