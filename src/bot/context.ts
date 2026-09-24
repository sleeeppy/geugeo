import type { AppConfig } from '../config.js';
import type { Logger } from '../log.js';
import type { UserApi } from '../discord/userApi.js';
import type { Registry } from '../store/registry.js';
import type { UserDirectory } from '../store/userStore.js';
import type { JobQueue } from '../sync/queue.js';
import type { Syncer } from '../sync/syncer.js';
import type { SemanticIndex } from '../search/semantic.js';
import type { SessionStore } from './sessions.js';

export interface AppContext {
  config: AppConfig;
  registry: Registry;
  users: UserDirectory;
  api: UserApi;
  queue: JobQueue;
  syncer: Syncer;
  sessions: SessionStore;
  semantic: SemanticIndex;
  log: Logger;
}
