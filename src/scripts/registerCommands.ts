import { REST, Routes } from 'discord.js';
import { loadConfig } from '../config.js';
import { buildCommands } from '../bot/commands.js';

const config = loadConfig({ requireDiscord: true });
const rest = new REST({ version: '10' }).setToken(config.botToken);
const body = buildCommands().map((command) => command.toJSON());
const route = Routes.applicationCommands(config.appId);
await rest.put(route, { body });
console.log(`명령어 ${body.length}개를 등록했어요.`);
