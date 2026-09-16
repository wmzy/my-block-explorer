// Error thrown by the HTTP layer for API failures. Kept byte-for-byte
// compatible with the previous ApiClient implementation (message, status,
// code?, details?) so views and services can keep branching on it
// unchanged.
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
