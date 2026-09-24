import { loadConfig, ConfigError } from './config.js';
import { createLogger } from './log.js';
import { UserApi } from './discord/userApi.js';
import { Registry } from './store/registry.js';
import { UserDirectory } from './store/userStore.js';
import { JobQueue } from './sync/queue.js';
import { Syncer } from './sync/syncer.js';
import { startScheduler } from './sync/scheduler.js';
import { SemanticIndex } from './search/semantic.js';
import { SessionStore } from './bot/sessions.js';
import { createBot } from './bot/client.js';
import type { AppContext } from './bot/context.js';

function main(): void {
  let config;
  try {
    config = loadConfig({ requireDiscord: true });
  } catch (error) {
    const message = error instanceof ConfigError ? error.message : '설정을 읽지 못했어요.';
    console.error(message);
    process.exit(1);
  }
  const log = createLogger(config.logLevel);
  const registry = new Registry(config.dataDir, config.masterKey);
  const users = new UserDirectory(config.dataDir, config.masterKey);
  const api = new UserApi({ delayMs: config.userApiDelayMs });
  const queue = new JobQueue(log);
  const syncer = new Syncer({ registry, users, api, masterKey: config.masterKey, log });
  const semantic = new SemanticIndex({ enabled: config.aiEnabled, users, queue, log, dataDir: config.dataDir });
  const ctx: AppContext = {
    config,
    registry,
    users,
    api,
    queue,
    syncer,
    sessions: new SessionStore(),
    semantic,
    log,
  };
  const client = createBot(ctx);
  startScheduler({ syncer, queue, registry, intervalMin: config.syncIntervalMin, log });
  void client.login(config.botToken).then(() => log.info('그거가 디스코드에 연결됐어요.'));
}

main();
