import { redactValue } from '../security/redaction.js';

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LocalLogger {
  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void;
}

export function createLocalLogger(sink: (line: string) => void = (line) => process.stderr.write(`${line}\n`)): LocalLogger {
  return {
    log(level, message, fields = {}) {
      sink(JSON.stringify(redactValue({ timestamp: new Date().toISOString(), level, message, ...fields })));
    },
  };
}
