# zodal-store-fs

Filesystem DataProvider adapter for zodal. Implements `DataProvider<T>` from `@zodal/store` using Node.js `fs` module.

## Architecture

- Factory function `createFsProvider<T>()` returns a `DataProvider<T>`
- Two storage modes: `directory` (one JSON file per item) and `file` (single JSON array)
- All query operations (sort, filter, search, pagination) are client-side
- Client-side query through `applyQuery()` from `@zodal/store` (the content provider passes `compareBinary` to keep code-unit string order)
- `create` with an existing id rejects; `upsert` overwrites
- `src/descriptor.ts` exports a provider descriptor per factory (`descriptor` = `fs`, `contentDescriptor` = `fsContent`, `blobDescriptor` = `fsBlob`), built with `defineProviderDescriptor` from `@zodal/store/descriptor`. Keep each options schema in step with its factory's options (validation strips undeclared keys); `create` imports the provider module lazily

## Key Skill

For the adapter pattern, conventions, and DataProvider contract, see:
https://github.com/i2mint/zodal/tree/main/.claude/skills/zodal-store-adapter

## Testing

```bash
pnpm test        # or: npx vitest run
```

Tests cover both storage modes via `describe.each`, using temporary directories. `tests/contract.test.ts` runs the shared `@zodal/store/testing` conformance kit against directory mode, file mode and the content provider. `tests/descriptor.test.ts` runs it again through `createFromDescriptor`, and checks validation errors, secret/live paths, described vs. reported capabilities, and composition under `bifurcatedDescriptor`.
