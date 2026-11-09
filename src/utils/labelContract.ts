// The address-label caps are a wire contract shared by two layers that
// must never drift apart: the write API (routes/labels.ts PUT body
// validation) and the backup format (util/localBackup.ts, whose restore
// re-PUTs every planned label and rejects over-cap files at parse time
// instead of failing N times mid-restore).

/** Max label length, in characters, after trimming. */
export const LABEL_MAX_LENGTH = 64;

/** Max note length, in characters, after trimming. */
export const NOTE_MAX_LENGTH = 500;
