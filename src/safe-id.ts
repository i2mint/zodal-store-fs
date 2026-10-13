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
 * Return `id` unchanged if it is safe to use as a single path segment, else throw.
 *
 * Rejects the empty id, `.` and `..`, and any id containing `/`, `\` or a NUL
 * byte -- which also rules out absolute paths on every platform.
 */
export function assertSafeId(id: string): string {
  if (RESERVED_IDS.has(id) || UNSAFE_ID_CHARS.test(id)) {
    throw new Error(
      `Unsafe id ${JSON.stringify(id)}: ids are used as file names, so they must be non-empty, ` +
        `must not be '.' or '..', and must not contain '/', '\\' or a NUL byte`,
    );
  }
  return id;
}
