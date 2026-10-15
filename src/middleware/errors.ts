import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from '../config/logger.js';

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export function asyncHandler(handler: RequestHandler): RequestHandler {
  return (req, res, next) => void Promise.resolve(handler(req, res, next)).catch(next);
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, 'not_found', 'Sumber daya tidak ditemukan.'));
};

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    void next;
    let appError: AppError;
    if (error instanceof AppError) appError = error;
    else if (error instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const issue of error.issues) fields[issue.path.join('.') || 'request'] = issue.message;
      appError = new AppError(
        400,
        'validation_error',
        'Periksa kembali data yang dikirim.',
        fields,
      );
    } else {
      logger.error({ err: error, requestId: req.requestId }, 'Unhandled request error');
      appError = new AppError(500, 'internal_error', 'Terjadi kesalahan pada server.');
    }
    res.status(appError.status).json({
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.fields ? { fields: appError.fields } : {}),
        requestId: req.requestId,
      },
    });
  };
}
