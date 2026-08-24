import { readFile } from 'node:fs/promises';

export interface BenchmarkQuestion {
  id: string;
  category: string;
  query: string;
  covered: boolean;
  baselineTokens: number;
  megaBrainTokens: number;
  baselineCorrect: boolean;
  megaBrainCorrect: boolean;
  freshness: 'FRESH' | 'POSSIBLY_STALE' | 'STALE' | 'CONFLICT' | 'DEPRECATED' | 'UNKNOWN';
  rawCodeFallback: boolean;
}

export interface MutationCase {
  id: string;
  mutation: string;
  observedFreshness: BenchmarkQuestion['freshness'];
}

export interface BenchmarkReport {
  questionCount: number;
  baselineQuality: number;
  megaBrainQuality: number;
  contextReduction: number;
  rawCodeFallbackRate: number;
  incorrectFresh: number;
  mutationFreshViolations: number;
  passed: boolean;
}

export function evaluateBenchmark(questions: BenchmarkQuestion[], mutations: MutationCase[]): BenchmarkReport {
  if (questions.length < 50 || questions.length > 100) throw new Error('Benchmark corpus must contain 50 to 100 questions');
  const covered = questions.filter(({ covered: isCovered }) => isCovered);
  const baselineQuality = questions.filter(({ baselineCorrect }) => baselineCorrect).length / questions.length;
  const megaBrainQuality = questions.filter(({ megaBrainCorrect }) => megaBrainCorrect).length / questions.length;
  const baselineTokens = questions.reduce((sum, question) => sum + question.baselineTokens, 0);
  const megaBrainTokens = questions.reduce((sum, question) => sum + question.megaBrainTokens, 0);
  const contextReduction = 1 - megaBrainTokens / baselineTokens;
  const rawCodeFallbackRate = covered.filter(({ rawCodeFallback }) => rawCodeFallback).length / covered.length;
  const incorrectFresh = questions.filter(({ megaBrainCorrect, freshness }) => !megaBrainCorrect && freshness === 'FRESH').length;
  const mutationFreshViolations = mutations.filter(({ observedFreshness }) => observedFreshness === 'FRESH').length;
  return {
    questionCount: questions.length,
    baselineQuality,
    megaBrainQuality,
    contextReduction,
    rawCodeFallbackRate,
    incorrectFresh,
    mutationFreshViolations,
    passed: megaBrainQuality >= baselineQuality && contextReduction >= 0.6 && rawCodeFallbackRate <= 0.25 && incorrectFresh === 0 && mutationFreshViolations === 0,
  };
}

export async function loadBenchmark(questionPath: string, mutationPath: string): Promise<BenchmarkReport> {
  const questions = JSON.parse(await readFile(questionPath, 'utf8')) as BenchmarkQuestion[];
  const mutations = JSON.parse(await readFile(mutationPath, 'utf8')) as MutationCase[];
  return evaluateBenchmark(questions, mutations);
}
