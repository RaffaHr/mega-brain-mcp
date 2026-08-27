import type { PromptAdapter, PromptChoice } from './prompts.js';
import type { SupportedHost } from './host-hooks.js';

export type HostSelection = 'codex' | 'claude' | 'both';

export const HOST_SELECTION_CHOICES = [
  { value: 'both', label: 'Codex and Claude Code' },
  { value: 'codex', label: 'Codex' },
  { value: 'claude', label: 'Claude Code' },
] as const satisfies readonly PromptChoice<HostSelection>[];

export function expandHostSelection(value: HostSelection): SupportedHost[] {
  return value === 'both' ? ['codex', 'claude'] : [value];
}

export function parseHostSelection(value: string | undefined): SupportedHost[] | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'both') return ['codex', 'claude'];
  if (normalized === 'codex') return ['codex'];
  if (normalized === 'claude') return ['claude'];
  if (normalized === 'codex,claude' || normalized === 'claude,codex') return ['codex', 'claude'];
  throw new Error('Invalid --hosts; expected codex, claude, both, or codex,claude');
}

export async function promptForHosts(
  prompts: PromptAdapter,
  message = 'Configure which hosts?',
): Promise<SupportedHost[] | null> {
  const selected = await prompts.select('hosts', message, HOST_SELECTION_CHOICES, 'both');
  return selected === null ? null : expandHostSelection(selected);
}
