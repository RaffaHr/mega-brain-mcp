# Tasks: P5 consolidation governance reconciliation

> feature: p5-consolidation-governance-reconciliation

## T-055 — Implementar motor determinístico de consolidação e supersessão de memórias [concluida]
- Refs: US-036, AC-089
- Arquivos: src/learning/consolidation.ts, src/provenance/repository.ts, test/p5-consolidation-governance-reconciliation.spec.test.js
- Notas: Agrupar memórias repetidas por arquivo e consolidar.
- Modelo: claude-sonnet-5
- Esforço: medio

## T-056 — Implementar expurgo de governança para arquivos deletados no Git [concluida]
- Refs: US-037, AC-090
- Arquivos: src/lifecycle/governance.ts, src/hooks/dispatcher.ts, src/server/application.ts, test/p5-consolidation-governance-reconciliation.spec.test.js
- Notas: Chamar governanceDelete no AgentMemory para caminhos excluídos.
- Modelo: claude-sonnet-5
- Esforço: medio

## T-057 — Implementar reconciliação em lote de memórias POSSIBLY_STALE [concluida]
- Refs: US-038, AC-091
- Arquivos: src/lifecycle/revalidation.ts, src/provenance/freshness.ts, src/server/application.ts, test/p5-consolidation-governance-reconciliation.spec.test.js
- Notas: Reavaliar hashes AST de símbolos em lote.
- Modelo: claude-sonnet-5
- Esforço: medio
