// Testes de spec da feature p2-symbol-lifecycle-git-intelligence
import { describe, expect, it } from 'vitest';
import { assessFreshness } from '../src/provenance/freshness.js';
import { calculateCoChangeCoupling } from '../src/adapters/git/history.js';
import { buildChangeContext } from '../src/orchestration/change-context.js';

describe('p2-symbol-lifecycle-git-intelligence', () => {
  // US-030 — Invalidação granular e ciclo de vida por símbolo AST
  it('AC-078: Preservação de status FRESH quando símbolo específico não foi alterado @spec:AC-078', () => {
    const evidence = [
      {
        path: 'src/auth.ts',
        symbol: 'validateToken',
        storedHash: 'file_hash_v1',
        currentHash: 'file_hash_v2', // Entire file modified
        storedSymbolHash: 'ast_token_hash_v1',
        currentSymbolHash: 'ast_token_hash_v1', // Symbol untouched
      },
    ];

    const assessment = assessFreshness({ evidence });
    expect(assessment.state).toBe('FRESH');
    expect(assessment.confidence).toBe(1);
    expect(assessment.reasons).toContain('all_evidence_hashes_match');
  });

  // US-030 — Invalidação granular e ciclo de vida por símbolo AST
  it('AC-079: Transição para STALE apenas quando o hash do símbolo for modificado @spec:AC-079', () => {
    const evidence = [
      {
        path: 'src/auth.ts',
        symbol: 'validateToken',
        storedHash: 'file_hash_v1',
        currentHash: 'file_hash_v2',
        storedSymbolHash: 'ast_token_hash_v1',
        currentSymbolHash: 'ast_token_hash_v2', // Symbol body changed
      },
    ];

    const assessment = assessFreshness({ evidence });
    expect(assessment.state).toBe('STALE');
    expect(assessment.confidence).toBe(0);
    expect(assessment.reasons).toContain('symbol_modified');
  });

  // US-031 — Mineração de acoplamento temporal (co-change coupling) no Git
  it('AC-080: Detecção de arquivos com acoplamento temporal histórico @spec:AC-080', async () => {
    const mockRepo = {
      async run(args) {
        if (args.includes('log')) {
          // 5 commits on src/auth.ts: 3 also touched src/jwt.ts (60% co-change), 1 touched src/user.ts (20% co-change)
          return [
            'COMMIT:1111111111111111111111111111111111111111\nsrc/auth.ts\nsrc/jwt.ts',
            'COMMIT:2222222222222222222222222222222222222222\nsrc/auth.ts\nsrc/jwt.ts',
            'COMMIT:3333333333333333333333333333333333333333\nsrc/auth.ts\nsrc/jwt.ts',
            'COMMIT:4444444444444444444444444444444444444444\nsrc/auth.ts\nsrc/user.ts',
            'COMMIT:5555555555555555555555555555555555555555\nsrc/auth.ts',
          ].join('\n');
        }
        return '';
      },
    };

    const result = await calculateCoChangeCoupling(mockRepo, 'src/auth.ts', 0.4, 6);

    expect(result.totalTargetCommits).toBe(5);
    expect(result.coChangedFiles).toContain('src/jwt.ts');
    expect(result.coChangedFiles).not.toContain('src/user.ts');
    expect(result.coChangeRates['src/jwt.ts']).toBe(0.6);
  });

  // US-031 — Mineração de acoplamento temporal (co-change coupling) no Git
  it('AC-081: Cálculo de risco de alteração baseado em churn e acoplamento @spec:AC-081', async () => {
    const structureFn = async (target) => ({
      dependencies: ['src/db.ts'],
      flows: ['handleAuth'],
      tests: ['tests/auth.test.ts'],
      coChangedFiles: ['src/jwt.ts', 'src/session.ts', 'src/cookie.ts'],
      riskWarning: `High change risk: ${target} has high churn and 3 co-changed files`,
    });

    const experienceFn = async () => ({
      rules: ['Auth requires HTTPS'],
      bugs: [],
      decisions: [],
      risks: [],
    });

    const result = await buildChangeContext(
      { target: 'src/auth.ts' },
      {
        structure: structureFn,
        experience: experienceFn,
      }
    );

    expect(result.coChangedFiles).toEqual(['src/cookie.ts', 'src/jwt.ts', 'src/session.ts']);
    expect(result.riskWarning).toContain('High change risk: src/auth.ts');
    expect(result.context).toContain('High change risk: src/auth.ts');
  });
});
