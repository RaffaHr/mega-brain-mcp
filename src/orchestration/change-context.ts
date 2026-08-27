import { buildContextPack, type RecallBudget } from './context-builder.js';
import type { EvidenceChunk } from './ranking.js';

export interface StructuralChangeContext {
  dependencies: string[];
  flows: string[];
  tests: string[];
}

export interface RememberedChangeContext {
  rules: string[];
  bugs: string[];
  decisions: string[];
  risks: string[];
}

export interface ChangeContextDependencies {
  structure(target: string): Promise<StructuralChangeContext>;
  experience(target: string): Promise<RememberedChangeContext>;
  maxTokenBudget?: number;
}

export interface ChangeContextResult extends StructuralChangeContext, RememberedChangeContext {
  target: string;
  context: string;
  estimatedTokens: number;
  budget: number;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function chunk(
  id: string,
  source: EvidenceChunk['source'],
  label: string,
  values: string[],
  reference: string,
): EvidenceChunk | null {
  if (values.length === 0) return null;
  return {
    id,
    source,
    text: `${label}:\n${values.map((value) => `- ${value}`).join('\n')}`,
    retrieval: 1,
    intentFit: 1,
    freshness: 1,
    confidence: 0.95,
    provenance: 1,
    reinforcement: 0,
    reference,
  };
}

export async function buildChangeContext(
  input: { target: string; budget?: RecallBudget },
  dependencies: ChangeContextDependencies,
): Promise<ChangeContextResult> {
  const [rawStructure, rawExperience] = await Promise.all([
    dependencies.structure(input.target),
    dependencies.experience(input.target),
  ]);
  const structure: StructuralChangeContext = {
    dependencies: unique(rawStructure.dependencies),
    flows: unique(rawStructure.flows),
    tests: unique(rawStructure.tests),
  };
  const experience: RememberedChangeContext = {
    rules: unique(rawExperience.rules),
    bugs: unique(rawExperience.bugs),
    decisions: unique(rawExperience.decisions),
    risks: unique(rawExperience.risks),
  };
  const candidates = [
    chunk('dependencies', 'code_review_graph', 'Dependencies', structure.dependencies, input.target),
    chunk('flows', 'code_review_graph', 'Flows', structure.flows, input.target),
    chunk('tests', 'git', 'Tests', structure.tests, input.target),
    chunk('rules', 'agentmemory', 'Rules', experience.rules, input.target),
    chunk('bugs', 'agentmemory', 'Bugs', experience.bugs, input.target),
    chunk('decisions', 'agentmemory', 'Decisions', experience.decisions, input.target),
    chunk('risks', 'agentmemory', 'Risks', experience.risks, input.target),
  ].filter((value): value is EvidenceChunk => value !== null);
  const pack = buildContextPack(candidates, input.budget ?? 'NORMAL', dependencies.maxTokenBudget);
  return {
    target: input.target,
    ...structure,
    ...experience,
    context: pack.text,
    estimatedTokens: pack.estimatedTokens,
    budget: pack.budget,
  };
}
