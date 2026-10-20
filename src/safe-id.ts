/**
 * Id validation for providers that turn item ids into file paths.
 *
 * Ids come from callers (in a web app, often straight from a URL), so an id
 * must never be able to name a path outside the store. Every provider in this
 * package builds its paths through `assertSafeId`, which rejects any id that
 * is not a single, ordinary path segment.
 */

/** Characters that would let an id span or escape a directory: separators and NUL. */
const UNSAFE_ID_CHARS = /[/\\\0]/;

/** Ids that are path segments in their own right: empty, current and parent directory. */
const RESERVED_IDS = new Set(['', '.', '..']);

/**
 * Return `id` as a string if it is safe to use as a single path segment, else throw.
 *
 * Rejects the empty id, `.` and `..`, and any id containing `/`, `\` or a NUL
 * byte -- which also rules out absolute paths on every platform. The id is
 * converted to a string exactly once and that string is both checked and
 * returned, so callers must build paths from the return value: a non-string id
 * whose `toString` changes between calls cannot pass the check as one value
 * and reach the filesystem as another.
 */
export function assertSafeId(id: unknown): string {
  const segment = String(id);
  if (RESERVED_IDS.has(segment) || UNSAFE_ID_CHARS.test(segment)) {
    throw new Error(
      `Unsafe id ${JSON.stringify(segment)}: ids are used as file names, so they must be non-empty, ` +
        `must not be '.' or '..', and must not contain '/', '\\' or a NUL byte`,
    );
  }
  return segment;
}

/** Check every id before a batch operation touches anything, so a bad id cannot leave it half done. */
export function assertSafeIds(ids: readonly unknown[]): void {
  for (const id of ids) assertSafeId(id);
}

/**
 * Throw if `data` carries an id that differs from the `id` being updated.
 *
 * Paths are built from `id` (usually checked against the caller's URL), so a
 * record whose own id field said otherwise would either be written under a
 * different file or stored with an id that does not match its file name.
 * Renaming an item is a create and a delete, not an update.
 */
export function assertIdUnchanged(id: string, data: Record<string, unknown>, idField: string): void {
  const given = data[idField];
  if (given !== undefined && String(given) !== String(id)) {
    throw new Error(
      `Cannot change ${JSON.stringify(idField)} in an update: item ${JSON.stringify(String(id))} ` +
        `was given ${JSON.stringify(String(given))}; create the new id and delete the old one instead`,
    );
  }
}
