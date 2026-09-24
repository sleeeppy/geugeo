import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { deniedMessage, isAllowed } from '../src/bot/guard.js';
import { randomMasterKey } from '../src/security/crypto.js';

describe('guard', () => {
  it('rejects a user who is not on the allow list', () => {
    const config = loadConfig({
      requireDiscord: true,
      envFile: '',
      env: {
        DISCORD_BOT_TOKEN: 'bot-token',
        DISCORD_APP_ID: 'app',
        ALLOWED_USER_IDS: '111, 222',
        MASTER_KEY: randomMasterKey().toString('base64'),
      },
    });
    expect(isAllowed(config, '111')).toBe(true);
    expect(isAllowed(config, '333')).toBe(false);
    expect(deniedMessage()).toBe('그거는 초대된 사람만 쓸 수 있어요.');
  });
});
