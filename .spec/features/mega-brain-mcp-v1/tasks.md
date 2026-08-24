# Tasks: Mega Brain MCP v1

> feature: mega-brain-mcp-v1

## Fase 1 — Fundação e contratos

## T-001 — Criar pacote TypeScript, servidor MCP e harness de testes [concluida]
- Refs: US-001, AC-002, US-010
- Arquivos: package.json, package-lock.json, tsconfig.json, vitest.config.ts, src/server/index.ts, src/server/envelope.ts, tests/contract/public-surface.test.ts
- Modelo: gpt-5.6-terra
- Esforço: medio
- Notas: Fixar a versão estável inspecionada de mcp-use; criar scripts build, test, test:spec e audit. Dependência: nenhuma.

## T-002 — Implementar configuração tipada e registro seguro de projetos [pendente]

- Refs: US-001, AC-003, US-008
- Arquivos: src/config/schema.ts, src/config/load.ts, src/projects/identity.ts, src/projects/registry.ts, tests/unit/config.test.ts, tests/unit/project-identity.test.ts
- Modelo: gpt-5.6-terra
- Esforço: medio
- Notas: Implementar precedência, env maps, denylist, aliases e identidade remote/root/worktree. Dependência: T-001.

## T-003 — Criar fixtures e gate de compatibilidade dos backends [pendente]

- Refs: US-001, US-006, US-009
- Arquivos: compatibility/agentmemory-0.9.29.json, compatibility/crg-2.3.8.json, src/compatibility/manifest.ts, src/compatibility/negotiate.ts, tests/contract/compatibility.test.ts
- Modelo: gpt-5.6-sol
- Esforço: alto
- Notas: Capturar capabilities e hashes de schemas; nenhuma adaptação silenciosa. Dependência: T-001.

## Fase 2 — Runtime e adapters

## T-004 — Implementar installer e supervisor de runtimes gerenciados [pendente]

- Refs: US-001, AC-001, US-009
- Arquivos: src/cli/install.ts, src/cli/start.ts, src/cli/stop.ts, src/runtime/layout.ts, src/runtime/supervisor.ts, src/runtime/lock-manifest.ts, tests/integration/runtime-manager.test.ts
- Modelo: gpt-5.6-sol
- Esforço: alto
- Notas: Instalação explícita, isolada, transacional e sem postinstall. Dependências: T-002, T-003.

## T-005 — Implementar adapter REST do AgentMemory [pendente]

- Refs: US-002, US-003, US-006
- Arquivos: src/adapters/agentmemory/client.ts, src/adapters/agentmemory/schemas.ts, src/adapters/agentmemory/capabilities.ts, tests/contract/agentmemory.test.ts
- Modelo: gpt-5.6-sol
- Esforço: alto
- Notas: Health/auth, smart-search, remember, verify, timeline/sessions e erros tipados. Dependências: T-002, T-003.

## T-006 — Implementar adapter MCP privado do Code Review Graph [pendente]

- Refs: US-002, US-004, US-005, US-006
- Arquivos: src/adapters/code-review-graph/client.ts, src/adapters/code-review-graph/allowlist.ts, src/adapters/code-review-graph/schemas.ts, tests/contract/code-review-graph.test.ts
- Modelo: gpt-5.6-sol
- Esforço: alto
- Notas: Child persistente, initialize/tools-list real, timeouts, restart e allowlist read-only. Dependências: T-002, T-003.

## T-007 — Implementar adapter Git e leitura tracked restrita [pendente]

- Refs: US-004, US-005, US-008, AC-020
- Arquivos: src/adapters/git/repository.ts, src/adapters/git/blobs.ts, src/adapters/git/history.ts, src/adapters/git/safe-read.ts, tests/integration/git-adapter.test.ts, tests/security/path-boundary.test.ts
- Modelo: gpt-5.6-sol
- Esforço: alto
- Notas: HEAD/index/worktree, blobs, diffs, branches, worktrees, symlinks e limites. Dependência: T-002.

## Fase 3 — Verdade e recuperação

## T-008 — Implementar metadata SQLite, provenance e freshness [pendente]

- Refs: US-003, US-004, AC-010, AC-011, AC-012, US-006
- Arquivos: src/provenance/database.ts, src/provenance/migrations.ts, src/provenance/repository.ts, src/provenance/freshness.ts, src/provenance/conflicts.ts, tests/integration/freshness.test.ts
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Schema versionado, estados determinísticos, invalidation e supersession. Dependências: T-005, T-006, T-007.

## T-009 — Implementar router, ranking, context builder, recall e status [pendente]

- Refs: US-002, AC-004, AC-005, AC-006, US-006
- Arquivos: src/orchestration/intent.ts, src/orchestration/router.ts, src/orchestration/ranking.ts, src/orchestration/context-builder.ts, src/tools/brain-recall.ts, src/tools/brain-status.ts, tests/integration/recall-status.test.ts
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Budgets, envelope, fontes por intenção e degradação. Dependências: T-005, T-006, T-007, T-008.

## Fase 4 — Evolução, mudança e tempo

## T-010 — Implementar aprendizado e validação [pendente]

- Refs: US-003, AC-007, AC-008, AC-009, US-004, US-006, AC-015
- Arquivos: src/learning/taxonomy.ts, src/learning/promotion.ts, src/learning/deduplication.ts, src/tools/brain-learn.ts, src/tools/brain-validate.ts, tests/integration/learn-validate.test.ts
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Conteúdo unverified, dedup/reforço, conflito e supersession; validar não reescreve memória. Dependências: T-008, T-009, T-013.

## T-011 — Implementar contexto de mudança e histórico [pendente]

- Refs: US-005, AC-013, AC-014
- Arquivos: src/orchestration/change-context.ts, src/orchestration/history.ts, src/tools/brain-change-context.ts, src/tools/brain-history.ts, tests/integration/change-history.test.ts
- Modelo: gpt-5.6-sol
- Esforço: alto
- Notas: Separar fatos históricos da estrutura atual e manter budgets. Dependências: T-005, T-006, T-007, T-008, T-009.

## Fase 5 — Lifecycle e segurança

## T-012 — Implementar dispatcher de hooks de Codex e Claude Code [pendente]

- Refs: US-007, AC-018, AC-019
- Arquivos: src/hooks/events.ts, src/hooks/dispatcher.ts, src/hooks/queue.ts, src/hooks/hosts/codex.ts, src/hooks/hosts/claude.ts, tests/integration/host-hooks.test.ts
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Merge atômico, backup, trust, redaction-before-delegation, idempotência e fail-open. Dependências: T-004, T-005, T-006, T-013.

## T-013 — Implementar redaction, política de egress e métricas locais [pendente]

- Refs: US-003, US-007, US-008, AC-021
- Arquivos: src/security/redaction.ts, src/security/secret-patterns.ts, src/security/egress-policy.ts, src/observability/metrics.ts, src/observability/logger.ts, tests/security/redaction.test.ts, tests/security/egress.test.ts
- Modelo: gpt-5.6-sol
- Esforço: alto
- Notas: Componente transversal; deve existir antes de learn e hooks. Dependências: T-001, T-002.

## T-014 — Implementar multiplexer Git e invalidação incremental [pendente]

- Refs: US-004, US-007, AC-017
- Arquivos: src/hooks/git/multiplexer.ts, src/hooks/git/install.ts, src/lifecycle/commit-handler.ts, src/lifecycle/revalidation.ts, tests/integration/git-hooks.test.ts
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Preservar hook path anterior, vincular commits, atualizar CRG e marcar blast radius. Dependências: T-007, T-008, T-012.

## Fase 6 — Operação, benchmark e release

## T-015 — Implementar doctor, upgrade e uninstall reversíveis [pendente]

- Refs: US-006, AC-016, US-009, AC-022, AC-023
- Arquivos: src/cli/doctor.ts, src/cli/upgrade.ts, src/cli/uninstall.ts, src/runtime/transaction.ts, tests/e2e/lifecycle.test.ts
- Modelo: gpt-5.6-sol
- Esforço: alto
- Notas: Handshake real, graph SHA versus HEAD, rollback e preserve-data padrão. Dependências: T-004, T-005, T-006, T-012, T-014.

## T-016 — Criar benchmark, CI, documentação e pacote de release [pendente]

- Refs: US-010, AC-024, AC-025
- Arquivos: benchmark/questions.json, benchmark/runner.ts, tests/e2e/benchmark.test.ts, .github/workflows/ci.yml, .github/workflows/release.yml, README.md, docs/configuration.md, docs/security.md, docs/troubleshooting.md, LICENSE
- Modelo: gpt-5.6-terra
- Esforço: alto
- Notas: Matriz Windows/Ubuntu, Node/Python suportados, SBOM, build provenance e npm dry-run. Dependências: T-009, T-010, T-011, T-012, T-014, T-015.
