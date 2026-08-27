import { buildChangeContext, type ChangeContextDependencies } from '../orchestration/change-context.js';
import type { RecallBudget } from '../orchestration/context-builder.js';
import { createEnvelope, type MegaBrainEnvelope } from '../server/envelope.js';

export interface BrainChangeContextDependencies extends ChangeContextDependencies {
  project: string;
  head: string;
}

export async function brainChangeContext(
  input: { target: string; budget?: RecallBudget },
  dependencies: BrainChangeContextDependencies,
): Promise<MegaBrainEnvelope> {
  const result = await buildChangeContext(input, dependencies);
  const hasStructure = result.dependencies.length + result.flows.length + result.tests.length + (result.coChangedFiles?.length ?? 0) > 0;
  const hasExperience = result.rules.length + result.bugs.length + result.decisions.length + result.risks.length > 0;
  const warnings = [
    ...(hasStructure ? [] : ['No current structural context was found']),
    ...(hasExperience ? [] : ['No remembered experience was found']),
    ...(result.riskWarning ? [result.riskWarning] : []),
  ];
  return createEnvelope(result as unknown as Record<string, unknown>, {
    status: warnings.length ? 'degraded' : 'ok',
    project: dependencies.project,
    head: dependencies.head,
    confidence: hasStructure && hasExperience ? 0.9 : 0.6,
    freshness: hasStructure ? 'FRESH' : 'UNKNOWN',
    sources: [
      ...(hasStructure ? [{ kind: 'code_review_graph' as const, reference: input.target, authority: 1 }] : []),
      ...(hasExperience ? [{ kind: 'agentmemory' as const, reference: input.target, authority: 0.8 }] : []),
    ],
    warnings,
  });
}
