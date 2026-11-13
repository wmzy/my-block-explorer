// The ONE record-shape guard. Nine sites used to hand-roll
// `typeof value === 'object' && value !== null` — a test that PASSES for
// arrays — while two others added `&& !Array.isArray(value)`, so the same
// name answered differently per file. The canonical rejects arrays: an
// array is never the object shape a caller is about to read properties
// from, and treating it as "not the expected shape" routes it to the
// caller's documented fallback instead of letting property reads return
// undefined downstream.
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
