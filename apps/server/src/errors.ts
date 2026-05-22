export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code = "HTTP_ERROR",
  ) {
    super(message);
  }
}
