import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler } from 'express';
import { ZodError, type ZodType } from 'zod';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (thing: string) => new ApiError(404, 'not_found', `${thing} not found.`);

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message, ...error.details } });
  } else if (error instanceof ZodError) {
    const issue = error.issues[0];
    const field = issue?.path.join('.');
    const message = field ? `${field}: ${issue?.message}` : (issue?.message ?? 'Invalid request.');
    res.status(422).json({ error: { code: 'invalid', message } });
  } else if (error?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'too_large', message: 'That file is too big.' } });
  } else if (error?.type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'bad_json', message: 'Invalid JSON.' } });
  } else {
    console.error(error);
    res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong on the server.' } });
  }
};
