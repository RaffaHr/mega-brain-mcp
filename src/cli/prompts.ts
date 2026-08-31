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
  explain?(message: string): void;
  notify(message: string): void;
  withSpinner?<T>(message: string, run: () => Promise<T>): Promise<T>;
}

export interface StructuredPromptWarning {
  level: 'warning' | 'important';
  code: string;
  message: string;
  requiresAttention: true;
}

function structuredWarning(id: string, message: string): StructuredPromptWarning | undefined {
  const match = /^\[(WARNING|IMPORTANT)\]\s*(.*)$/u.exec(message.trim());
  if (!match?.[1] || !match[2]) return undefined;
  return {
    level: match[1] === 'IMPORTANT' ? 'important' : 'warning',
    code: `SETUP_${id.replace(/([a-z0-9])([A-Z])/gu, '$1_$2').replace(/[^A-Za-z0-9]+/gu, '_').toUpperCase()}`,
    message: match[2],
    requiresAttention: true,
  };
}

export function createJsonPromptAdapter(base: PromptAdapter): {
  prompts: PromptAdapter;
  warnings: () => readonly StructuredPromptWarning[];
} {
  const warnings: StructuredPromptWarning[] = [];
  const record = (id: string, message: string): string => {
    const warning = structuredWarning(id, message);
    if (warning) warnings.push(warning);
    return warning?.message ?? message;
  };
  return {
    prompts: {
      interactive: base.interactive,
      intro: async () => undefined,
      input: (id, message, defaultValue) => base.input(id, message, defaultValue),
      select: (id, message, choices, defaultValue) => base.select(id, message, choices, defaultValue),
      ...(base.checkbox ? { checkbox: (id, message, choices, defaults) => base.checkbox!(id, message, choices, defaults) } : {}),
      confirm: (id, message, defaultValue) => base.confirm(id, record(id, message), defaultValue),
      explain: () => undefined,
      notify(message) { void record('notice', message); },
      withSpinner: (_message, run) => run(),
    },
    warnings: () => warnings.map((warning) => ({ ...warning })),
  };
}

export function createTerminalPrompts(input: Readable = process.stdin, output: Writable = process.stderr): PromptAdapter {
  const interactive = Boolean((input as NodeJS.ReadStream).isTTY && (output as NodeJS.WriteStream).isTTY);
  const context = { input, output, clearPromptOnDone: true };
  let transientLines = 0;
  const clearTransient = () => {
    if (!interactive || transientLines === 0) return;
    output.write(`\x1b[${transientLines}F\x1b[J`);
    transientLines = 0;
  };
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
        } finally {
          clearTransient();
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
        } finally {
          clearTransient();
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
        } finally {
          clearTransient();
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
        } finally {
          clearTransient();
        }
      }
      const answer = await ask(`${message} [${defaultValue ? 'Y/n' : 'y/N'}]: `);
      if (answer === null) return null;
      if (!answer.trim()) return defaultValue;
      return /^(?:y|yes|s|sim)$/iu.test(answer.trim());
    },
    explain(message) {
      const rendered = renderTerminalMarkdown(message, output as NodeJS.WriteStream);
      output.write(`${rendered}\n`);
      if (interactive) transientLines = rendered.split('\n').length + 1;
    },
    notify(message) { output.write(`${renderTerminalMarkdown(message, output as NodeJS.WriteStream)}\n`); },
    withSpinner(message, run) { return withTerminalSpinner(output as NodeJS.WriteStream, message, run); },
  };
}
