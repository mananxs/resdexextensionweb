/** Shared error type: carries the HTTP status that route handlers should answer with. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}
