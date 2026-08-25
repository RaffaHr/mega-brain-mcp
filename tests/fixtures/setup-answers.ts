import type { PromptAdapter, PromptChoice } from '../../src/cli/prompts.js';

export class ScriptedPrompts implements PromptAdapter {
  readonly interactive = true;
  readonly messages: string[] = [];

  constructor(private readonly answers: Record<string, unknown[]>) {}

  private next<T>(id: string, fallback: T): T | null {
    const answer = this.answers[id]?.shift();
    if (answer === null) return null;
    return (answer === undefined || answer === '' ? fallback : answer) as T;
  }

  input(id: string, _message: string, defaultValue = ''): Promise<string | null> {
    return Promise.resolve(this.next(id, defaultValue));
  }

  select<T extends string>(id: string, _message: string, _choices: readonly PromptChoice<T>[], defaultValue: T): Promise<T | null> {
    return Promise.resolve(this.next(id, defaultValue));
  }

  confirm(id: string, _message: string, defaultValue: boolean): Promise<boolean | null> {
    return Promise.resolve(this.next(id, defaultValue));
  }

  notify(message: string): void { this.messages.push(message); }
}
