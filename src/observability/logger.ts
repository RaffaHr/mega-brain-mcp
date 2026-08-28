import { redactValue } from '../security/redaction.js';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LocalLogger {
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
}

export interface LocalLoggerOptions {
  environment?: NodeJS.ProcessEnv;
}

export function debugLoggingEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
  const level = environment.MEGA_BRAIN_LOG_LEVEL?.trim().toLowerCase();
  if (level === 'debug') return true;
  const debug = environment.MEGA_BRAIN_DEBUG?.trim().toLowerCase();
  return /^(?:1|true|yes|on|debug)$/u.test(debug ?? '');
}

export function createLocalLogger(
  sink: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
  options: LocalLoggerOptions = {},
): LocalLogger {
  const enabled = debugLoggingEnabled(options.environment ?? process.env);
  return {
    log(level, message, fields = {}) {
      if (!enabled) return;
      sink(JSON.stringify(redactValue({ timestamp: new Date().toISOString(), level, message, ...fields })));
    },
  };
}
