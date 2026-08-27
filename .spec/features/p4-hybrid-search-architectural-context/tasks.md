# Tasks: P4 hybrid search architectural context

> feature: p4-hybrid-search-architectural-context

## T-052 — Implementar tabela virtual FTS5 e busca lexical BM25 no ProvenanceRepository [concluida]
- Refs: US-034, AC-086
- Arquivos: src/provenance/migrations.ts, src/provenance/repository.ts, test/p4-hybrid-search-architectural-context.spec.test.js
- Notas: Criar tabela FTS5 com tokenizador unicode61 e Porter stemmer no SQLite.
- Modelo: claude-sonnet-5
- Esforço: medio

## T-053 — Integrar canal lexical local no RRF Ranker e application handlers [concluida]
- Refs: US-034, AC-087
- Arquivos: src/orchestration/ranking.ts, src/orchestration/router.ts, src/server/application.ts, test/p4-hybrid-search-architectural-context.spec.test.js
- Notas: Incluir canal provenance_lexical no rank fusion k=60.
- Modelo: claude-sonnet-5
- Esforço: medio

## T-054 — Injetar visão geral de arquitetura do CRG no Context Builder em queries de arquitetura [concluida]
- Refs: US-035, AC-088
- Arquivos: src/server/application.ts, src/orchestration/context-builder.ts, test/p4-hybrid-search-architectural-context.spec.test.js
- Notas: Invocar get_architecture_overview_tool do CRG quando intent for architecture.
- Modelo: claude-sonnet-5
- Esforço: medio
