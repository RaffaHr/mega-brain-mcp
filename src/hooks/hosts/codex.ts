import { CODEX_HOOK_EVENTS } from '../events.js';

export interface HostHookConfig {
  hooks?: Record<string, Array<Record<string, unknown>>>;
  [key: string]: unknown;
}

export interface HostHookInstallation {
  config: HostHookConfig;
  backup: HostHookConfig;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function installCodexHooks(existing: HostHookConfig, command: string): HostHookInstallation {
  const backup = clone(existing);
  const config = clone(existing);
  config.hooks ??= {};
  for (const event of CODEX_HOOK_EVENTS) {
    const registrations = config.hooks[event] ?? [];
    const megaBrain = { hooks: [{ type: 'command', command, timeout: 5, statusMessage: 'Mega Brain capture' }], _megaBrain: true };
    config.hooks[event] = [...registrations.filter((entry) => entry._megaBrain !== true), megaBrain];
  }
  return { config, backup };
}

export function uninstallCodexHooks(installation: HostHookInstallation): HostHookConfig {
  return clone(installation.backup);
}
