# zodal-store-fs

zodal DataProvider adapter for local filesystem (Node.js).

Two storage modes:

- **Directory mode** (default): Each item is a separate `{id}.json` file in a folder. Good for larger datasets and concurrent access.
- **Single-file mode**: All items stored in one JSON array file. Simpler for small datasets.

All query operations (sort, filter, search, pagination) are evaluated client-side.

## Install

```bash
npm install zodal-store-fs @zodal/core @zodal/store
```

## Quick Start

### Directory mode (default)

Each item becomes a separate JSON file:

```typescript
import { createFsProvider } from 'zodal-store-fs';

const provider = createFsProvider<Project>({
  path: './data/projects',
});

// Creates ./data/projects/{id}.json for each item
await provider.create({ name: 'My Project', status: 'active' });

const { data, total } = await provider.getList({
  filter: { field: 'status', operator: 'eq', value: 'active' },
  sort: [{ id: 'name', desc: false }],
  pagination: { page: 1, pageSize: 25 },
});
```

### Single-file mode

All items in one JSON file:

```typescript
import { createFsProvider } from 'zodal-store-fs';

const provider = createFsProvider<Project>({
  path: './data/projects.json',
  mode: 'file',
});

// All items stored in ./data/projects.json as a JSON array
await provider.create({ name: 'My Project', status: 'active' });
```

## Capabilities

| Capability | Supported |
|---|---|
| Create / Update / Delete | Yes |
| Bulk Update / Delete | Yes |
| Upsert | Yes |
| Server-side Sort | No (client-side) |
| Server-side Filter | No (client-side) |
| Server-side Search | No (client-side) |
| Server-side Pagination | No (client-side) |
| Real-time | No |

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `path` | `string` | (required) | Directory path (directory mode) or file path (file mode) |
| `mode` | `'directory' \| 'file'` | `'directory'` | Storage mode |
| `idField` | `string` | `'id'` | Field name used as unique identifier |
| `searchFields` | `string[]` | all string fields | Fields to include in text search |

## When to use which mode

- **Directory mode**: Better for larger datasets, allows concurrent reads, individual file diffs in version control, and partial updates without rewriting everything.
- **File mode**: Simpler for small datasets, single file to back up or transfer, atomic reads of the full dataset.

## License

MIT
