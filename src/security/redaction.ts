import { SECRET_KEY_PATTERN, SECRET_TEXT_PATTERNS } from './secret-patterns.js';

const REDACTED = '[REDACTED]';
const TOKEN_CANDIDATE = /\b[A-Za-z0-9_+\/=.-]{32,}\b/g;

function entropy(value: string): number {
  const frequencies = new Map<string, number>();
  for (const character of value) frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  return [...frequencies.values()].reduce((sum, count) => {
    const probability = count / value.length;
    return sum - probability * Math.log2(probability);
  }, 0);
}

function looksLikeSafeIdentifier(value: string): boolean {
  return /^[a-f0-9]{32,64}$/i.test(value) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(value);
}

export function redactText(input: string): string {
  let output = input;
  for (const pattern of SECRET_TEXT_PATTERNS) {
    output = output.replace(pattern, (match, prefix: string | undefined) => {
      if (match.startsWith('-----BEGIN')) return REDACTED;
      return `${prefix ?? ''}${REDACTED}`;
    });
  }
  return output.replace(TOKEN_CANDIDATE, (candidate) => {
    if (candidate === REDACTED || looksLikeSafeIdentifier(candidate)) return candidate;
    return entropy(candidate) >= 4 ? REDACTED : candidate;
  });
}

export function redactValue(value: unknown, key = ''): unknown {
  if (SECRET_KEY_PATTERN.test(key) && value !== undefined && value !== null) return REDACTED;
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([nestedKey, nestedValue]) => [nestedKey, redactValue(nestedValue, nestedKey)]));
  }
  return value;
}

export function redactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return redactValue(value) as Record<string, unknown>;
}
