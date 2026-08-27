# Tasks: P3 context engine auto learning

> feature: p3-context-engine-auto-learning

## Tarefas

### T-049 — Implementar extrator semântico de commits e geração de memórias CANDIDATE [concluida]
- **Refs:** US-032, AC-082
- **Arquivos:** src/lifecycle/commit-handler.ts, src/learning/taxonomy.ts, src/provenance/repository.ts, test/p3-context-engine-auto-learning.spec.test.js
- **Status:** [concluida]

### T-050 — Implementar promoção de memórias candidatas via eventos de validação e testes [concluida]
- **Refs:** US-032, AC-083
- **Arquivos:** src/learning/promotion.ts, src/hooks/dispatcher.ts, src/server/application.ts, test/p3-context-engine-auto-learning.spec.test.js
- **Status:** [concluida]

### T-051 — Enriquecer diagnósticos de observabilidade e alertas de saúde no brain_status [concluida]
- **Refs:** US-033, AC-084, AC-085
- **Arquivos:** src/tools/brain-status.ts, src/observability/metrics.ts, src/server/application.ts, test/p3-context-engine-auto-learning.spec.test.js
- **Status:** [concluida]
