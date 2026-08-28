import { createInterface } from 'node:readline/promises';
import type { Readable, Writable } from 'node:stream';

import { checkbox as checkboxPrompt, confirm as confirmPrompt, input as inputPrompt, select as selectPrompt } from '@inquirer/prompts';

import { playMegaBrainLogo } from './brand.js';
import { cliLabel, cliMuted, cliPromptTheme, renderTerminalMarkdown, withTerminalSpinner } from './ui.js';

export interface PromptChoice<T extends string> {
  value: T;
  label: string;
}

export interface PromptAdapter {
  readonly interactive: boolean;
  intro?(): Promise<void>;
  input(id: string, message: string, defaultValue?: string): Promise<string | null>;
  select<T extends string>(id: string, message: string, choices: readonly PromptChoice<T>[], defaultValue: T): Promise<T | null>;
  checkbox?<T extends string>(id: string, message: string, choices: readonly PromptChoice<T>[], defaultValues: readonly T[]): Promise<T[] | null>;
  confirm(id: string, message: string, defaultValue: boolean): Promise<boolean | null>;
  notify(message: string): void;
  withSpinner?<T>(message: string, run: () => Promise<T>): Promise<T>;
}

export function createTerminalPrompts(input: Readable = process.stdin, output: Writable = process.stderr): PromptAdapter {
  const interactive = Boolean((input as NodeJS.ReadStream).isTTY && (output as NodeJS.WriteStream).isTTY);
  const context = { input, output, clearPromptOnDone: true };
  const ask = async (message: string): Promise<string | null> => {
    const terminal = createInterface({ input, output });
    try { return await terminal.question(message); }
    catch { return null; }
    finally { terminal.close(); }
  };
  return {
    interactive,
    async intro() {
      if (interactive) await playMegaBrainLogo(output as NodeJS.WriteStream);
    },
    async input(id, message, defaultValue = '') {
      if (interactive) {
        try {
          return await inputPrompt({ message: cliLabel(message), default: defaultValue, theme: cliPromptTheme(id) }, context);
        } catch {
          return null;
        }
      }
      const answer = await ask(`${message}${defaultValue ? ` [${defaultValue}]` : ''}: `);
      return answer === null ? null : answer.trim() || defaultValue;
    },
    async select(id, message, choices, defaultValue) {
      if (interactive) {
        try {
          return await selectPrompt({
            message: cliLabel(message),
            choices: choices.map((choice) => ({
              value: choice.value,
              name: choice.value === defaultValue ? `${choice.label} ${cliMuted('(default)')}` : choice.label,
            })),
            default: defaultValue,
            theme: cliPromptTheme(id),
          }, context);
        } catch {
          return null;
        }
      }
      output.write(`${message}\n${choices.map((choice, index) => `  ${index + 1}. ${choice.label}${choice.value === defaultValue ? ' (default)' : ''}`).join('\n')}\n`);
      const answer = await ask('Choice: ');
      if (answer === null) return null;
      if (!answer.trim()) return defaultValue;
      const index = Number(answer) - 1;
      return choices[index]?.value ?? choices.find(({ value }) => value === answer.trim())?.value ?? defaultValue;
    },
    async checkbox(id, message, choices, defaultValues) {
      if (interactive) {
        try {
          return await checkboxPrompt({
            message: cliLabel(message),
            choices: choices.map((choice) => ({
              value: choice.value,
              name: choice.label,
              checked: defaultValues.includes(choice.value),
            })),
            required: true,
            theme: cliPromptTheme(id),
          }, context);
        } catch {
          return null;
        }
      }
      output.write(`${message}\n${choices.map((choice, index) => `  ${index + 1}. [${defaultValues.includes(choice.value) ? 'x' : ' '}] ${choice.label}`).join('\n')}\n`);
      const answer = await ask('Choices: ');
      if (answer === null) return null;
      if (!answer.trim()) return [...defaultValues];
      const selected = answer.split(',').map((item) => item.trim()).filter(Boolean);
      const values = selected.flatMap((item) => {
        const index = Number(item) - 1;
        const choice = choices[index] ?? choices.find(({ value }) => value === item);
        return choice ? [choice.value] : [];
      });
      return values.length > 0 ? [...new Set(values)] : [...defaultValues];
    },
    async confirm(id, message, defaultValue) {
      if (interactive) {
        try {
          return await confirmPrompt({ message: cliLabel(message), default: defaultValue, theme: cliPromptTheme(id) }, context);
        } catch {
          return null;
        }
      }
      const answer = await ask(`${message} [${defaultValue ? 'Y/n' : 'y/N'}]: `);
      if (answer === null) return null;
      if (!answer.trim()) return defaultValue;
      return /^(?:y|yes|s|sim)$/iu.test(answer.trim());
    },
    notify(message) { output.write(`${renderTerminalMarkdown(message, output as NodeJS.WriteStream)}\n`); },
    withSpinner(message, run) { return withTerminalSpinner(output as NodeJS.WriteStream, message, run); },
  };
}
