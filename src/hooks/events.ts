import { createHash } from 'node:crypto';

export const CODEX_HOOK_EVENTS = [
  'SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PreCompact', 'Stop',
] as const;

export const CLAUDE_HOOK_EVENTS = [
  'Notification', 'PostToolUse', 'PostToolUseFailure', 'PreCompact', 'PreToolUse', 'SessionEnd',
  'SessionStart', 'Stop', 'SubagentStart', 'SubagentStop', 'TaskCompleted', 'UserPromptSubmit',
] as const;

export type HookHost = 'codex' | 'claude' | 'git';
export type CanonicalHookEvent =
  | 'notification' | 'tool_succeeded' | 'tool_failed' | 'before_compaction' | 'before_tool'
  | 'session_ended' | 'session_started' | 'stopped' | 'subagent_started' | 'subagent_stopped'
  | 'task_completed' | 'prompt_submitted' | 'git_changed';

const EVENT_MAP: Record<string, CanonicalHookEvent> = {
  Notification: 'notification',
  PostToolUse: 'tool_succeeded',
  PostToolUseFailure: 'tool_failed',
  PreCompact: 'before_compaction',
  PreToolUse: 'before_tool',
  SessionEnd: 'session_ended',
  SessionStart: 'session_started',
  Stop: 'stopped',
  SubagentStart: 'subagent_started',
  SubagentStop: 'subagent_stopped',
  TaskCompleted: 'task_completed',
  UserPromptSubmit: 'prompt_submitted',
};

export interface NormalizedHookEvent {
  key: string;
  host: HookHost;
  event: CanonicalHookEvent;
  occurredAt: string;
  payload: Record<string, unknown>;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  }
  return value;
}

export function normalizeHookEvent(
  host: HookHost,
  eventName: string,
  payload: Record<string, unknown>,
  now = new Date(),
): NormalizedHookEvent {
  const allowed = host === 'codex' ? CODEX_HOOK_EVENTS : CLAUDE_HOOK_EVENTS;
  if (!(allowed as readonly string[]).includes(eventName)) throw new Error(`Unsupported ${host} hook event: ${eventName}`);
  const event = EVENT_MAP[eventName];
  if (!event) throw new Error(`No canonical mapping for hook event: ${eventName}`);
  const explicitKey = typeof payload.idempotencyKey === 'string' ? payload.idempotencyKey : undefined;
  const identity = stable({ host, event, session: payload.session_id ?? payload.sessionId, turn: payload.turn_id ?? payload.turnId, tool: payload.tool_use_id ?? payload.toolUseId, payload });
  const key = explicitKey ?? createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  return { key, host, event, occurredAt: now.toISOString(), payload };
}
