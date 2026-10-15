import type { RequestHandler } from 'express';
import type { ZodType } from 'zod';

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  };
}

export function validateQuery<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    schema.parse(req.query);
    next();
  };
}

export function validateParams<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    req.params = schema.parse(req.params) as typeof req.params;
    next();
  };
}
