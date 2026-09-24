import type { AppConfig } from '../config.js';
import { COPY } from './ui/theme.js';

export function isAllowed(config: AppConfig, userId: string): boolean {
  return config.allowedUserIds.has(userId);
}

export function deniedMessage(): string {
  return COPY.denied;
}
