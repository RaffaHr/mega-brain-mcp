# Tasks: P6 git temporal symbol intelligence

> feature: p6-git-temporal-symbol-intelligence

## T-058 — Implementar mineração de histórico por símbolo com Git Pickaxe [concluida]
- Refs: US-039, AC-092
- Arquivos: src/adapters/git/history.ts, src/tools/brain-history.ts, test/p6-git-temporal-symbol-intelligence.spec.test.js
- Notas: Extrair histórico via git log -S <symbol>.
- Modelo: claude-sonnet-5
- Esforço: medio

## T-059 — Integrar timeline ancorada do AgentMemory no brain_history [concluida]
- Refs: US-040, AC-093
- Arquivos: src/server/application.ts, src/tools/brain-history.ts, test/p6-git-temporal-symbol-intelligence.spec.test.js
- Notas: Conectar endpoint timeline do AgentMemory em brain_history.
- Modelo: claude-sonnet-5
- Esforço: medio

## T-060 — Implementar contagem de churn e alerta de risco por símbolo no brain_change_context [concluida]
- Refs: US-041, AC-094
- Arquivos: src/orchestration/change-context.ts, src/tools/brain-change-context.ts, src/server/application.ts, test/p6-git-temporal-symbol-intelligence.spec.test.js
- Notas: Minerar churn do símbolo e anexar warning em brain_change_context.
- Modelo: claude-sonnet-5
- Esforço: medio
