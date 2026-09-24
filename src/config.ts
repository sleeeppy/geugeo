import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { LogLevel } from './log.js';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface AppConfig {
  botToken: string;
  appId: string;
  allowedUserIds: ReadonlySet<string>;
  masterKey: Buffer;
  dataDir: string;
  aiEnabled: boolean;
  syncIntervalMin: number;
  userApiDelayMs: number;
  logLevel: LogLevel;
}

export interface LoadOptions {
  requireDiscord?: boolean;
  requireMasterKey?: boolean;
  env?: NodeJS.ProcessEnv;
  envFile?: string;
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  process.loadEnvFile(path);
}

export function readMasterKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const credentialsDir = env.CREDENTIALS_DIRECTORY;
  if (credentialsDir) {
    const credentialPath = resolve(credentialsDir, 'master-key');
    if (existsSync(credentialPath)) {
      return decodeMasterKey(readFileSync(credentialPath, 'utf8').trim(), credentialPath);
    }
  }
  if (env.MASTER_KEY_FILE) {
    const file = env.MASTER_KEY_FILE;
    if (!existsSync(file)) {
      throw new ConfigError(`마스터 키 파일을 찾을 수 없어요: ${file}`);
    }
    return decodeMasterKey(readFileSync(file, 'utf8').trim(), file);
  }
  if (env.MASTER_KEY) return decodeMasterKey(env.MASTER_KEY.trim(), 'MASTER_KEY');
  throw new ConfigError('마스터 키가 없어요. MASTER_KEY, MASTER_KEY_FILE, 또는 systemd credential(master-key)이 필요해요.');
}

function decodeMasterKey(raw: string, source: string): Buffer {
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new ConfigError(`${source} 마스터 키는 base64로 인코딩된 32바이트여야 해요.`);
  }
  return key;
}

export function loadConfig(options: LoadOptions = {}): AppConfig {
  if (options.envFile !== '') {
    loadEnvFile(options.envFile ?? '.env');
  }
  const env = options.env ?? process.env;
  const requireDiscord = options.requireDiscord ?? true;
  const requireMasterKey = options.requireMasterKey ?? true;
  const missing: string[] = [];
  const botToken = env.DISCORD_BOT_TOKEN?.trim() ?? '';
  const appId = env.DISCORD_APP_ID?.trim() ?? '';
  const allowedRaw = env.ALLOWED_USER_IDS?.trim() ?? '';
  if (requireDiscord) {
    if (!botToken) missing.push('DISCORD_BOT_TOKEN');
    if (!appId) missing.push('DISCORD_APP_ID');
    if (!allowedRaw) missing.push('ALLOWED_USER_IDS');
  }
  let masterKey: Buffer;
  try {
    masterKey = readMasterKey(env);
  } catch (error) {
    if (!requireMasterKey) {
      masterKey = Buffer.alloc(32);
    } else {
      if (!requireDiscord && !env.MASTER_KEY && !env.MASTER_KEY_FILE && !env.CREDENTIALS_DIRECTORY) {
        throw error;
      }
      missing.push('MASTER_KEY');
      masterKey = Buffer.alloc(32);
    }
  }
  if (missing.length > 0) {
    throw new ConfigError(`필수 설정이 비어 있어요: ${missing.join(', ')}`);
  }
  const allowedUserIds = new Set(
    allowedRaw
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
  const logLevel = env.LOG_LEVEL?.trim() || 'info';
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new ConfigError('LOG_LEVEL은 debug, info, warn, error 중 하나여야 해요.');
  }
  return {
    botToken,
    appId,
    allowedUserIds,
    masterKey,
    dataDir: env.DATA_DIR?.trim() || './data',
    aiEnabled: (env.AI_ENABLED?.trim() || 'true') !== 'false',
    syncIntervalMin: positiveInt(env.SYNC_INTERVAL_MIN, 30, 'SYNC_INTERVAL_MIN'),
    userApiDelayMs: positiveInt(env.USER_API_DELAY_MS, 1200, 'USER_API_DELAY_MS'),
    logLevel: logLevel as LogLevel,
  };
}

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new ConfigError(`${name}는 0 이상의 정수여야 해요.`);
  }
  return value;
}
