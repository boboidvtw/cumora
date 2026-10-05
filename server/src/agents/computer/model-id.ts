/** Model ids are interpolated into engine argv. On Windows that argv is joined
 * into a cmd.exe command line, so the id has to be a single token. Vendor ids
 * use letters, digits, and `.` `_` `:` `/` `-`. Anything else is rejected. */
export const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/

export class InvalidModelIdError extends Error {
  constructor() {
    super('invalid model id')
    this.name = 'InvalidModelIdError'
  }
}

/** `undefined` leaves the stored value alone, `null` clears it, a string sets
 * it. A non-string is ignored. A string that is not a model id throws. */
export function parseModelId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!MODEL_ID_RE.test(trimmed)) throw new InvalidModelIdError()
  return trimmed
}

/** Spawn-time guard. An id that does not match is dropped instead of being
 * passed to the shell. `local` is not a model id; callers handle it first. */
export function modelIdOrNull(value: string | null | undefined): string | null {
  if (value == null) return null
  try {
    return parseModelId(value) ?? null
  } catch (error) {
    if (error instanceof InvalidModelIdError) return null
    throw error
  }
}
