export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const TOKEN_PATTERN = /[\w-]{24,}\.[\w-]{6}\.[\w-]{27,}/g;
const REDACTED_KEYS = new Set([
  'content',
  'search_text',
  'searchtext',
  'token',
  'token_enc',
  'authorization',
  'masterkey',
  'master_key',
]);

export function maskSecrets(value: string): string {
  return value.replace(TOKEN_PATTERN, '[token]');
}

export function sanitize(value: unknown): unknown {
  if (typeof value === 'string') return maskSecrets(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (value instanceof Error) {
    return { name: value.name, message: maskSecrets(value.message) };
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (REDACTED_KEYS.has(key.toLowerCase())) {
        out[key] = '[redacted]';
      } else {
        out[key] = sanitize(item);
      }
    }
    return out;
  }
  return maskSecrets(String(value));
}

export interface Logger {
  debug(message: string, fields?: unknown): void;
  info(message: string, fields?: unknown): void;
  warn(message: string, fields?: unknown): void;
  error(message: string, fields?: unknown): void;
}

export function createLogger(level: LogLevel = 'info'): Logger {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const write = (name: LogLevel, message: string, fields?: unknown) => {
    if (LEVELS[name] < threshold) return;
    const line = {
      t: new Date().toISOString(),
      level: name,
      message: maskSecrets(message),
      ...(fields === undefined ? {} : { fields: sanitize(fields) }),
    };
    const text = JSON.stringify(line);
    if (name === 'error') console.error(text);
    else if (name === 'warn') console.warn(text);
    else console.log(text);
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
  };
}
