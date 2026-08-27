export type HistorySource = 'git' | 'agentmemory_session' | 'agentmemory_memory' | 'agentmemory_timeline';

export interface HistoryItem {
  id: string;
  source: HistorySource;
  occurredAt: string;
  summary: string;
  reference: string;
}

export interface HistoryQuery {
  query?: string;
  anchor?: string;
  symbol?: string;
  start?: string;
  end?: string;
  limit?: number;
}

export interface HistoryDependencies<TStructure = unknown> {
  commits(input: HistoryQuery): Promise<HistoryItem[]>;
  memories(input: HistoryQuery): Promise<HistoryItem[]>;
  sessions(input: HistoryQuery): Promise<HistoryItem[]>;
  timeline?(input: HistoryQuery): Promise<HistoryItem[]>;
  symbolCommits?(symbol: string, limit?: number): Promise<HistoryItem[]>;
  currentStructure(): Promise<TStructure>;
}

export interface HistoryResult<TStructure = unknown> {
  timeline: HistoryItem[];
  currentStructure: TStructure;
  separation: 'historical_events_are_immutable_current_structure_is_a_snapshot';
}

function inRange(item: HistoryItem, start?: string, end?: string): boolean {
  const timestamp = Date.parse(item.occurredAt);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid history timestamp for ${item.id}`);
  return (start === undefined || timestamp >= Date.parse(start)) && (end === undefined || timestamp <= Date.parse(end));
}

export async function assembleHistory<TStructure>(
  input: HistoryQuery,
  dependencies: HistoryDependencies<TStructure>,
): Promise<HistoryResult<TStructure>> {
  const limit = input.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('History limit must be between 1 and 100');
  if (input.start !== undefined && !Number.isFinite(Date.parse(input.start))) throw new Error('Invalid history start');
  if (input.end !== undefined && !Number.isFinite(Date.parse(input.end))) throw new Error('Invalid history end');
  if (input.start !== undefined && input.end !== undefined && Date.parse(input.start) > Date.parse(input.end)) {
    throw new Error('History start must not be after end');
  }
  const [commits, memories, sessions, anchoredTimeline, symbolHistory, currentStructure] = await Promise.all([
    dependencies.commits(input),
    dependencies.memories(input),
    dependencies.sessions(input),
    dependencies.timeline ? dependencies.timeline(input) : Promise.resolve([]),
    dependencies.symbolCommits && input.symbol ? dependencies.symbolCommits(input.symbol, limit) : Promise.resolve([]),
    dependencies.currentStructure(),
  ]);
  const timeline = [...commits, ...memories, ...sessions, ...anchoredTimeline, ...symbolHistory]
    .filter((item) => inRange(item, input.start, input.end))
    .sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt) || left.id.localeCompare(right.id))
    .slice(-limit)
    .map((item) => ({ ...item }));
  return {
    timeline,
    currentStructure,
    separation: 'historical_events_are_immutable_current_structure_is_a_snapshot',
  };
}
