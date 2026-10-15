import type { NextFunction, Request, Response } from 'express';
import { redactOperationalValue } from '../config/logger.js';

const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};
const SENSITIVE_QUERY_KEY =
  /(?:authorization|cookie|password|secret|token|apikey|otp|buffer|credential|proof|code|state|cursor|email|participantref|displayname|telemetry|fsrraw|prompt|metrics)/iu;
const SENSITIVE_PATH_PARENT = new Set(['participants', 'game-sessions', 'game-preparations', 'devices']);

export function sanitizeUrlForLog(originalUrl: string): string {
  const parsed = new URL(originalUrl, 'http://arka.local');
  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEY.test(key.replace(/[^a-z]/giu, ''))) {
      parsed.searchParams.set(key, '[REDACTED]');
    }
  }
  const segments = parsed.pathname.split('/');
  for (let index = 1; index < segments.length; index += 1) {
    if (SENSITIVE_PATH_PARENT.has(segments[index - 1] ?? '')) segments[index] = '[REDACTED]';
  }
  const search = parsed.searchParams.size > 0 ? `?${parsed.searchParams.toString()}` : '';
  return `${segments.join('/')}${search}`;
}

function statusColor(status: number): string {
  if (status < 300) return COLORS.green;
  if (status < 400) return COLORS.yellow;
  return COLORS.red;
}

function formatBody(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  try {
    const serialized = JSON.stringify(redactOperationalValue(body), (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    if (serialized === '{}' || serialized === '[]') return '';
    return serialized.length > 500 ? `${serialized.slice(0, 500)}...` : serialized;
  } catch {
    return '[Payload tidak dapat ditampilkan]';
  }
}

export function formatHttpLogLines(input: {
  method: string;
  originalUrl: string;
  statusCode: number;
  durationMs: number;
  timestamp: string;
  requestId: string;
  ip?: string | undefined;
  multipart?: boolean;
  params?: unknown;
  query?: unknown;
  body?: unknown;
  responseBody?: unknown;
}): string[] {
  const color = statusColor(input.statusCode);
  let line =
    `${COLORS.dim}${input.timestamp}${COLORS.reset} ` +
    `${COLORS.cyan}${input.method.padEnd(6)}${COLORS.reset} ${sanitizeUrlForLog(input.originalUrl)} ` +
    `${color}${input.statusCode}${COLORS.reset} ` +
    `${COLORS.magenta}${input.durationMs}ms${COLORS.reset} ` +
    `${COLORS.dim}${input.requestId.replace(/[\r\n\x1b]/gu, '').slice(0, 128)}${COLORS.reset}`;
  if (input.ip) line += ` ${COLORS.dim}${input.ip}${COLORS.reset}`;
  const lines = [`${COLORS.dim}${'='.repeat(72)}${COLORS.reset}`, line];
  const authRoute = input.originalUrl.split('?', 1)[0]?.startsWith('/api/auth/') ?? false;
  const body = authRoute || input.multipart ? '' : formatBody(input.body);
  const response = authRoute ? '' : formatBody(input.responseBody);
  if (body) lines.push(`  ${COLORS.dim}-> req:${COLORS.reset} ${body}`);
  if (response) lines.push(`  ${COLORS.dim}<- res:${COLORS.reset} ${response}`);
  return lines;
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const originalJson = res.json.bind(res);
  let responseBody: unknown;

  res.json = ((body: unknown) => {
    responseBody = body;
    return originalJson(body);
  }) as Response['json'];

  res.once('finish', () => {
    console.log(formatHttpLogLines({
      method: req.method,
      originalUrl: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
      ip: req.ip,
      multipart: Boolean(req.is('multipart/form-data')),
      body: req.body,
      responseBody,
    }).join('\n'));
  });

  next();
}
