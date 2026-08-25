# Tasks: Runtime autônomo e isolado por projeto

> feature: autonomous-project-runtime

## T-024 — Unificar configuração e resolução de caminhos [pendente]

- Refs: US-020, AC-046, AC-050, AC-051, AC-053
- Arquivos: src/config/schema.ts, src/config/load.ts, src/config/project-config.ts, src/runtime/layout.ts, tests/unit/config.test.ts, tests/unit/project-identity.test.ts, .env.example
- Modelo: gpt-5.6-sol
- Esforço: alto
- Notas: Criar um resolver imutável usado por todos os comandos; caminhos relativos partem de `repoPath`; configuração local não contém segredos. Deve fechar os defeitos de `MEGA_BRAIN_DATA_DIR` e `MEGA_BRAIN_PORT`. Dependência: nenhuma.

## T-025 — Implementar supervisor por projeto, IPC e leases [pendente]

- Refs: US-017, AC-040, AC-041, US-019, AC-048
- Arquivos: src/runtime/project-supervisor.ts, src/runtime/ipc.ts, src/runtime/leases.ts, src/runtime/supervisor.ts, src/runtime/types.ts, tests/integration/project-supervisor.test.ts, tests/security/path-boundary.test.ts
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Garantir lock atômico por `worktreeId`, handshake autenticado sem segredo persistido, recuperação segura de lease/lock obsoleto, readiness por identidade e idle shutdown após a última lease. Depende de T-024.

## T-026 — Expor MCP stdio autônomo e adaptar os hosts [pendente]

- Refs: US-017, AC-039, AC-040, AC-041
- Arquivos: src/cli/mcp.ts, src/server/stdio.ts, src/server/application.ts, src/cli/host-integration.ts, src/hooks/hosts/codex.ts, src/hooks/hosts/claude.ts, tests/integration/stdio-mcp.test.ts, tests/integration/host-integration.test.ts
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Registrar comando+args do projeto em vez de URL no fluxo padrão; preservar Streamable HTTP como modo explícito; conectar cada processo stdio ao supervisor por lease e expor somente as seis tools. Depende de T-025.

## T-027 — Criar o assistente interativo de setup [pendente]

- Refs: US-018, AC-042, AC-043, AC-044, AC-045, AC-049, AC-053
- Arquivos: src/cli/setup.ts, src/cli/prompts.ts, src/cli/index.ts, src/config/project-config.ts, tests/integration/setup.test.ts, tests/fixtures/setup-answers.ts
- Modelo: gpt-5.6-terra
- Esforço: alto
- Notas: Modelar o wizard como máquina de estados injetável/testável; defaults locais seguros; resumo redigido; cancelamento e preflight sem mutação; terminal sem TTY orienta `install`. O setup delega a instalação ao mesmo serviço transacional. Depende de T-024 e T-029.

## T-028 — Tornar instalação, upgrade e rollback uma transação única [pendente]

- Refs: US-018, AC-042, AC-045, US-021, AC-054
- Arquivos: src/runtime/transaction.ts, src/cli/install.ts, src/cli/upgrade.ts, src/cli/uninstall.ts, src/cli/host-hooks.ts, src/cli/host-integration.ts, tests/integration/install-transaction.test.ts, tests/integration/runtime-manager.test.ts
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Fazer staging, snapshot de runtime e integrações e commit coordenado; em qualquer erro restaurar ambos. Uninstall drena leases, restaura host/hooks e mantém dados salvo `--purge`. Depende de T-024; integra com T-025 e T-026 antes do gate final.

## T-029 — Garantir isolamento físico dos backends [pendente]

- Refs: US-019, AC-046, AC-047, AC-048, AC-049, US-020, AC-052
- Arquivos: src/cli/install.ts, src/cli/start.ts, src/cli/doctor.ts, src/adapters/agentmemory/client.ts, src/adapters/agentmemory/capabilities.ts, src/adapters/code-review-graph/client.ts, src/adapters/code-review-graph/capabilities.ts, src/compatibility/manifest.ts, tests/contract/agentmemory.test.ts, tests/contract/code-review-graph.test.ts, tests/integration/backend-isolation.test.ts
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Alocar endpoints por projeto, encaminhar data dirs absolutos, exigir prova de storage do CRG e namespace remoto, validar identidade no readiness e mostrar paths efetivos no doctor sem segredos. Depende de T-024.

## T-030 — Provar lifecycle autônomo, concorrência e matriz completa [pendente]

- Refs: AC-039, AC-041, AC-044, AC-045, AC-047, AC-048, AC-050, AC-051, AC-052, AC-054, AC-055, AC-056
- Arquivos: tests/e2e/autonomous-lifecycle.test.ts, tests/e2e/concurrent-projects.test.ts, tests/e2e/package-lifecycle.test.ts, scripts/test-isolated-lifecycle.mjs, tests/contract/package-boundary.test.ts, .github/workflows/ci.yml, README.md, docs/configuration.md, docs/troubleshooting.md, package.json
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Consumir apenas o tarball em Node 22.22 e 24.19; abrir clientes MCP stdio reais; testar duas sessões no mesmo projeto e dois projetos concorrentes; injetar falha pós-staging; confirmar cleanup e uninstall. Documentar setup interativo e instalação automatizada. Depende de T-025 a T-029.
