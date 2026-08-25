import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

export interface PromptChoice<T extends string> {
  value: T;
  label: string;
}

export interface PromptAdapter {
  readonly interactive: boolean;
  input(id: string, message: string, defaultValue?: string): Promise<string | null>;
  select<T extends string>(id: string, message: string, choices: readonly PromptChoice<T>[], defaultValue: T): Promise<T | null>;
  confirm(id: string, message: string, defaultValue: boolean): Promise<boolean | null>;
  notify(message: string): void;
}

export function createTerminalPrompts(input: Readable = process.stdin, output: Writable = process.stderr): PromptAdapter {
  const ask = async (message: string): Promise<string | null> => {
    const terminal = createInterface({ input, output });
    try { return await terminal.question(message); }
    catch { return null; }
    finally { terminal.close(); }
  };
  return {
    interactive: Boolean((input as NodeJS.ReadStream).isTTY && (output as NodeJS.WriteStream).isTTY),
    async input(_id, message, defaultValue = '') {
      const answer = await ask(`${message}${defaultValue ? ` [${defaultValue}]` : ''}: `);
      return answer === null ? null : answer.trim() || defaultValue;
    },
    async select(_id, message, choices, defaultValue) {
      output.write(`${message}\n${choices.map((choice, index) => `  ${index + 1}. ${choice.label}${choice.value === defaultValue ? ' (default)' : ''}`).join('\n')}\n`);
      const answer = await ask('Choice: ');
      if (answer === null) return null;
      if (!answer.trim()) return defaultValue;
      const index = Number(answer) - 1;
      return choices[index]?.value ?? choices.find(({ value }) => value === answer.trim())?.value ?? defaultValue;
    },
    async confirm(_id, message, defaultValue) {
      const answer = await ask(`${message} [${defaultValue ? 'Y/n' : 'y/N'}]: `);
      if (answer === null) return null;
      if (!answer.trim()) return defaultValue;
      return /^(?:y|yes|s|sim)$/iu.test(answer.trim());
    },
    notify(message) { output.write(`${message}\n`); },
  };
}
