# Tasks: Runtime autônomo e isolado por projeto

> feature: autonomous-project-runtime

## T-024 — Unificar configuração e resolução de caminhos [concluida]
- Refs: US-020, AC-046, AC-050, AC-051, AC-053
- Arquivos: src/config/schema.ts, src/config/load.ts, src/config/project-config.ts, src/runtime/layout.ts, tests/unit/config.test.ts, tests/unit/project-identity.test.ts, .env.example
- Modelo: gpt-5.6-sol
- Esforço: alto
- Notas: Criar um resolver imutável usado por todos os comandos; precedência canônica `flags > env do processo > .env do repositório > configuração > defaults`; caminhos relativos partem de `repoPath`; configuração local guarda apenas referências a variáveis de segredo. Deve fechar os defeitos de `MEGA_BRAIN_DATA_DIR` e `MEGA_BRAIN_PORT` e modelar os modos AgentMemory `managed`/`remote` com os quatro endpoints. Dependência: nenhuma.

## T-025 — Implementar supervisor por projeto, IPC e leases [concluida]
- Refs: US-017, AC-040, AC-041, US-019, AC-048
- Arquivos: src/cli/supervisor.ts, src/runtime/project-supervisor.ts, src/runtime/supervisor-manifest.ts, src/runtime/ipc.ts, src/runtime/leases.ts, src/runtime/supervisor.ts, src/runtime/types.ts, tests/unit/leases.test.ts, tests/integration/project-supervisor.test.ts, tests/security/path-boundary.test.ts
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: O primeiro gateway inicia o mesmo `supervisor` como processo independente; garantir lock atômico por `worktreeId`, manifesto sem segredo, named pipe restrito ao usuário no Windows/socket `0600` no Unix, validação de protocolo+PID+identidade, heartbeat de 10 s, expiração de 30 s, grace de 5 s e relógio injetável. Readiness varia por modo e o idle shutdown ocorre após a última lease. Depende de T-024.

## T-029 — Garantir isolamento físico dos backends [concluida]
- Refs: US-018, AC-042, AC-044, AC-053, US-019, AC-046, AC-047, AC-048, AC-049, US-020, AC-052
- Arquivos: src/cli/install.ts, src/cli/start.ts, src/cli/doctor.ts, src/cli/preflight.ts, src/runtime/iii-engine.ts, src/runtime/lock-manifest.ts, src/adapters/agentmemory/client.ts, src/adapters/agentmemory/schemas.ts, src/adapters/agentmemory/capabilities.ts, src/adapters/code-review-graph/client.ts, src/adapters/code-review-graph/capabilities.ts, src/server/application.ts, src/compatibility/manifest.ts, compatibility/agentmemory-0.9.29.json, compatibility/crg-2.3.7.json, tests/contract/agentmemory.test.ts, tests/contract/code-review-graph.test.ts, tests/integration/backend-isolation.test.ts, tests/integration/remote-agentmemory.test.ts
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Em `managed`, alocar os quatro endpoints AgentMemory por projeto e, no Windows, instalar o `iii-engine` pinado em runtime isolado após confirmação e checksum, sem PATH global. Em `remote`, persistir apenas URL e nome da variável que contém o SECRET, sem instalar/iniciar runtime local. Propagar `project` em todas as chamadas, provar namespace com sentinel A/B reversível e cleanup confirmado somente contra backend fake/descartável, encaminhar `CRG_DATA_DIR` e `CRG_REPO_ROOT` absolutos e validar identidade/readiness. Depende de T-024.

## T-026 — Expor MCP stdio autônomo e adaptar os hosts [concluida]
- Refs: US-017, AC-039, AC-040, AC-041
- Arquivos: src/cli/mcp.ts, src/server/stdio.ts, src/cli/host-integration.ts, src/hooks/hosts/codex.ts, src/hooks/hosts/claude.ts, tests/integration/stdio-mcp.test.ts, tests/integration/host-integration.test.ts
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Registrar comando+args do projeto em vez de URL no fluxo padrão; preservar Streamable HTTP como modo explícito; conectar cada processo stdio ao supervisor por lease e expor somente as seis tools. Depende de T-025.

## T-027 — Criar o assistente interativo de setup [concluida]
- Refs: US-018, AC-042, AC-043, AC-044, AC-045, AC-049, AC-053
- Arquivos: src/cli/setup.ts, src/cli/prompts.ts, src/cli/index.ts, src/config/project-config.ts, tests/integration/setup.test.ts, tests/fixtures/setup-answers.ts
- Modelo: gpt-5.6-terra
- Esforço: alto
- Notas: Modelar o wizard como máquina de estados injetável/testável; defaults locais seguros; resumo redigido; cancelamento e preflight sem mutação; terminal sem TTY orienta `install`. URL/SECRET remoto inválido mantém o usuário no mesmo passo para novas tentativas ou troca para `managed`; o setup delega a instalação ao mesmo serviço transacional. Depende de T-024 e T-029.

## T-028 — Tornar instalação, upgrade e rollback uma transação única [concluida]
- Refs: US-018, AC-042, AC-045, US-021, AC-054
- Arquivos: src/runtime/transaction.ts, src/cli/install.ts, src/cli/upgrade.ts, src/cli/uninstall.ts, src/cli/host-hooks.ts, src/cli/host-integration.ts, tests/integration/install-transaction.test.ts, tests/integration/runtime-manager.test.ts
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Fazer staging, snapshot de runtime, `iii-engine`, backends e integrações e commit coordenado; em qualquer erro restaurar tudo. `install` inválido falha antes de downloads, arquivos ou processos. Uninstall drena leases, restaura host/hooks e mantém dados salvo `--purge`. Depende de T-024, T-025, T-026, T-027 e T-029.

## T-031 — Corrigir inicialização sem Git, logs e UX da CLI [concluida]
- Refs: US-018, AC-057, AC-058, AC-059, AC-060, AC-061
- Arquivos: src/projects/identity.ts, src/server/application.ts, src/cli/index.ts, src/cli/mcp.ts, src/cli/install.ts, src/cli/setup.ts, src/cli/prompts.ts, src/cli/ui.ts, src/runtime/transaction.ts, src/cli/stop.ts, src/cli/uninstall.ts, tests/unit/project-identity.test.ts, tests/integration/application.test.ts, tests/integration/stdio-mcp.test.ts, tests/integration/runtime-manager.test.ts, tests/integration/install-transaction.test.ts
- Modelo: gpt-5.6-terra
- Esforço: alto
- Notas: Identidade sem Git deve ser estável; logs de MCP precisam ir para stderr; prompts ricos não podem quebrar fallback sem TTY.

## T-030 — Provar lifecycle autônomo, concorrência e matriz completa [concluida]
- Refs: AC-039, AC-041, AC-044, AC-045, AC-047, AC-048, AC-049, AC-050, AC-051, AC-052, AC-054, AC-055, AC-056
- Arquivos: tests/spec/autonomous-project-runtime.spec.test.ts, tests/e2e/autonomous-lifecycle.test.ts, tests/e2e/concurrent-projects.test.ts, tests/e2e/package-lifecycle.test.ts, scripts/test-isolated-lifecycle.mjs, tests/contract/package-boundary.test.ts, .github/workflows/ci.yml, README.md, docs/configuration.md, docs/troubleshooting.md, package.json
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Consumir apenas o tarball em Node 22.22 e 24.19; usar configuração npm descartável; quando o preflight não for o objeto do teste, iniciar subprocessos com versão suportada explícita em vez de herdar o Node local. Abrir clientes MCP stdio reais; testar duas sessões no mesmo projeto e dois projetos concorrentes; injetar falha pós-staging; confirmar probe cleanup e uninstall. Documentar Windows, setup interativo, `managed` e `remote`. Depende de T-025 a T-029.
