# Tasks: Fase0 hardening

> feature: fase0-hardening

## T-032 — Redação obrigatória em payloads de git hooks [concluida]
- Refs: US-022, AC-062
- Arquivos: src/cli/hook.ts, tests/integration/git-hook-redaction.test.ts
- Notas: Aplicar redactRecord no stdin e hookArgs antes de enfileirar falha ou despachar evento.
- Modelo: claude-sonnet-5
- Esforço: medio

## T-033 — Fila durável com isolamento concorrente e replay [concluida]
- Refs: US-022, AC-063
- Arquivos: src/hooks/queue.ts, src/hooks/dispatcher.ts, tests/integration/hook-queue.test.ts
- Notas: Garantir que has() diferencie eventos pendentes/falhos de concluídos e adicionar proteção de concorrência.
- Modelo: claude-sonnet-5
- Esforço: alto

## T-034 — Deduplicação de evidências com símbolo ausente via migration v2 [concluida]
- Refs: US-023, AC-064
- Arquivos: src/provenance/migrations.ts, src/provenance/repository.ts, tests/integration/provenance-dedup.test.ts
- Notas: Migration v2 para tratar símbolo vazio/nulo de forma única e evitar inserções infinitas.
- Modelo: claude-sonnet-5
- Esforço: alto

## T-035 — Configuração de busy_timeout no SQLite [concluida]
- Refs: US-023, AC-065
- Arquivos: src/provenance/database.ts, tests/integration/database-concurrency.test.ts
- Notas: Executar PRAGMA busy_timeout = 5000 na inicialização de better-sqlite3 e node:sqlite.
- Modelo: claude-sonnet-5
- Esforço: medio

## T-036 — Rebalanceamento de scores em change-context [concluida]

- Refs: US-024, AC-066
- Arquivos: src/orchestration/change-context.ts, tests/integration/change-context-ranking.test.ts
- Notas: Remover penalidade artificial de 0.8 do AgentMemory para igualdade justa no corte de tokens.
- Modelo: claude-sonnet-5
- Esforço: medio

## T-037 — Consulta paralela a fontes em brain-recall [concluida]

- Refs: US-024, AC-067
- Arquivos: src/tools/brain-recall.ts, tests/integration/brain-recall-parallel.test.ts
- Notas: Executar adapters em paralelo com Promise.allSettled ou Promise.all com captura de erro por fonte.
- Modelo: claude-sonnet-5
- Esforço: medio

## T-038 — Instrumentação de métricas em recall [concluida]

- Refs: US-025, AC-068
- Arquivos: src/tools/brain-recall.ts, src/orchestration/ranking.ts, tests/integration/recall-metrics.test.ts
- Notas: Conectar observability/metrics.ts para registrar tempos de resposta e contagem de chunks.
- Modelo: claude-sonnet-5
- Esforço: medio

## T-039 — Parse de rename no git status [concluida]

- Refs: US-025, AC-069
- Arquivos: src/adapters/git/repository.ts, tests/integration/git-rename.test.ts
- Notas: Tratar status R no parser de porcelain e ler caminhos com separação NUL sem corromper lista.
- Modelo: claude-sonnet-5
- Esforço: medio
