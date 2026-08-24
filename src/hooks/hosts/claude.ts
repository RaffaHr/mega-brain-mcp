import { CLAUDE_HOOK_EVENTS } from '../events.js';
import type { HostHookConfig, HostHookInstallation } from './codex.js';

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function installClaudeHooks(existing: HostHookConfig, command: string): HostHookInstallation {
  const backup = clone(existing);
  const config = clone(existing);
  config.hooks ??= {};
  for (const event of CLAUDE_HOOK_EVENTS) {
    const registrations = config.hooks[event] ?? [];
    const megaBrain = { hooks: [{ type: 'command', command, timeout: 5 }], _megaBrain: true };
    config.hooks[event] = [...registrations.filter((entry) => entry._megaBrain !== true), megaBrain];
  }
  return { config, backup };
}

export function uninstallClaudeHooks(installation: HostHookInstallation): HostHookConfig {
  return clone(installation.backup);
}
