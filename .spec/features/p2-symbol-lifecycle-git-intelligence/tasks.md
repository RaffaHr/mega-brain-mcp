# Tasks: P2 symbol lifecycle git intelligence

> feature: p2-symbol-lifecycle-git-intelligence

## Tarefas

### T-046 — Implementar extrator de hash AST por símbolo e revalidação granular [concluida]
- **Refs:** US-030, AC-078, AC-079
- **Arquivos:** src/provenance/freshness.ts, src/lifecycle/revalidation.ts, src/provenance/repository.ts, test/p2-symbol-lifecycle-git-intelligence.spec.test.js
- **Status:** [concluida]

### T-047 — Implementar mineração de acoplamento temporal no adaptador Git [concluida]
- **Refs:** US-031, AC-080
- **Arquivos:** src/adapters/git/history.ts, src/adapters/git/repository.ts, src/tools/brain-change-context.ts, test/p2-symbol-lifecycle-git-intelligence.spec.test.js
- **Status:** [concluida]

### T-048 — Adicionar cálculo de risco por churn e co-mudança em change-context [concluida]
- **Refs:** US-031, AC-081
- **Arquivos:** src/orchestration/change-context.ts, src/tools/brain-change-context.ts, src/server/application.ts, test/p2-symbol-lifecycle-git-intelligence.spec.test.js
- **Status:** [concluida]
