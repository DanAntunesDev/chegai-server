import { HttpException, HttpStatus } from '@nestjs/common';

export interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class AppError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus, details?: unknown) {
    const body: ErrorBody = details === undefined ? { code, message } : { code, message, details };
    super(body, status);
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new AppError(code, message, HttpStatus.BAD_REQUEST, details);
  }

  static unauthorized(code: string, message: string) {
    return new AppError(code, message, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(code: string, message: string) {
    return new AppError(code, message, HttpStatus.FORBIDDEN);
  }

  static notFound(code: string, message: string) {
    return new AppError(code, message, HttpStatus.NOT_FOUND);
  }

  static conflict(code: string, message: string, details?: unknown) {
    return new AppError(code, message, HttpStatus.CONFLICT, details);
  }
}
