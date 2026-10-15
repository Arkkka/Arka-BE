import type { NextFunction, Request, Response } from 'express';
import { redactOperationalValue } from '../config/logger.js';

const PREVIEW_LIMIT = 400;
const SENSITIVE_QUERY_KEY =
  /(?:authorization|cookie|password|secret|token|credential|proof|code|state|cursor|email|participantref|displayname|telemetry|fsrraw|prompt|metrics)/iu;
const SENSITIVE_PATH_PARENT = new Set(['participants', 'game-sessions', 'game-preparations', 'devices']);

function stringify(value: unknown): string {
  try {
    return JSON.stringify(redactOperationalValue(value), (_key, nested: unknown) =>
      typeof nested === 'bigint' ? nested.toString() : nested,
    );
  } catch {
    return '[Payload tidak dapat ditampilkan]';
  }
}

function preview(value: unknown): string {
  const serialized = stringify(value);
  return serialized.length > PREVIEW_LIMIT
    ? `${serialized.slice(0, PREVIEW_LIMIT)}…`
    : serialized;
}

function hasValues(value: unknown): boolean {
  return typeof value === 'object' && value !== null && Object.keys(value).length > 0;
}

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
  if (!process.stdout.isTTY) return '';
  if (status >= 500) return '\x1b[31m';
  if (status >= 400) return '\x1b[33m';
  if (status >= 300) return '\x1b[36m';
  return '\x1b[32m';
}

function color(value: string): string {
  return process.stdout.isTTY ? value : '';
}

export function formatHttpLogLines(input: {
  method: string;
  originalUrl: string;
  statusCode: number;
  durationMs: number;
  timestamp: string;
  requestId: string;
  params?: unknown;
  query?: unknown;
  body?: unknown;
  responseBody?: unknown;
}): string[] {
  const reset = color('\x1b[0m');
  const gray = color('\x1b[90m');
  const cyan = color('\x1b[36m');
  const bold = color('\x1b[1m');
  const status = statusColor(input.statusCode);
  const lines = [
    `${gray}${'─'.repeat(72)}${reset}`,
    `${bold}${input.method.padEnd(7)}${reset}${status}${String(input.statusCode).padEnd(4)}${reset} ${sanitizeUrlForLog(input.originalUrl)} ${gray}${input.durationMs}ms  [${input.timestamp}]  ${input.requestId}${reset}`,
  ];
  const authRoute = input.originalUrl.split('?', 1)[0]?.startsWith('/api/auth/') ?? false;
  for (const [label, value] of [
    ['params', input.params],
    ['query', input.query],
    ['body', authRoute ? undefined : input.body],
  ] as const) {
    if (hasValues(value)) lines.push(`${cyan}  ↑ ${label.padEnd(7)}${reset} ${preview(value)}`);
  }
  if (!authRoute && input.responseBody !== undefined) {
    lines.push(`${status}  ↓ response${reset} ${preview(input.responseBody)}`);
  }
  return lines;
}

export function prettyHttpLogger(request: Request, response: Response, next: NextFunction): void {
  const startedAt = performance.now();
  const originalJson = response.json.bind(response);
  let responseBody: unknown;

  response.json = ((body: unknown) => {
    responseBody = body;
    return originalJson(body);
  }) as Response['json'];

  response.once('finish', () => {
    const lines = formatHttpLogLines({
      method: request.method,
      originalUrl: request.originalUrl,
      statusCode: response.statusCode,
      durationMs: Math.round(performance.now() - startedAt),
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      params: request.params,
      query: request.query,
      body: request.body,
      responseBody,
    });
    for (const line of lines) console.log(line);
  });

  next();
}
