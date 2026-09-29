export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const unauthorized = (message = 'authentication required') => new HttpError(401, message);
export const forbidden = (message = 'forbidden') => new HttpError(403, message);
export const notFound = (message = 'not found') => new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);
