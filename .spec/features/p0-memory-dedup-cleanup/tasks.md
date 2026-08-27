# Tasks: P0 memory dedup cleanup

> feature: p0-memory-dedup-cleanup

## T-040 — Eliminar criação de memórias sintéticas em reforço e conflito [concluida]
- Refs: US-026, AC-070
- Arquivos: src/server/application.ts, src/tools/brain-learn.ts, test/p0-memory-dedup-cleanup.spec.test.js
- Notas: Atualizar score e metadados sem gravar nova string artificial no AgentMemory.
- Modelo: claude-sonnet-5
- Esforço: medio

## T-041 — Registrar supersessão exclusivamente na proveniência e metadados [concluida]
- Refs: US-026, AC-071
- Arquivos: src/server/application.ts, src/tools/brain-learn.ts, src/provenance/repository.ts, test/p0-memory-dedup-cleanup.spec.test.js
- Notas: Gravar relacionamento na tabela de supersessões sem poluir o vector space do AgentMemory.
- Modelo: claude-sonnet-5
- Esforço: medio

## T-042 — Implementar truncamento seguro de blocos e deduplicação no Context Builder [concluida]
- Refs: US-027, AC-072, AC-073
- Arquivos: src/orchestration/context-builder.ts, src/orchestration/ranking.ts, test/p0-memory-dedup-cleanup.spec.test.js
- Notas: Cortar em limites de linha/bloco e deduplicar chunks equivalentes.
- Modelo: claude-sonnet-5
- Esforço: medio
