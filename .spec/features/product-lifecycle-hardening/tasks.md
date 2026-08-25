# Tasks: Hardening do ciclo de vida do produto

> feature: product-lifecycle-hardening

## T-020 — Implementar preflight sem efeitos colaterais [concluida]

- Refs: US-013, AC-030, AC-031
- Arquivos: src/cli/preflight.ts, src/cli/install.ts, src/cli/index.ts, tests/integration/preflight.test.ts, tests/integration/runtime-manager.test.ts
- Modelo: gpt-5.6-sol
- Esforço: alto
- Notas: Validar Node, Python e Git antes de mkdir/npm/pip/hooks; mensagens devem incluir versão encontrada e mínimo. Dependência: nenhuma.

## T-021 — Integrar MCP e hooks de Codex e Claude Code [concluida]

- Refs: US-014, AC-032, AC-033
- Arquivos: src/cli/host-integration.ts, src/cli/host-hooks.ts, src/hooks/hosts/codex.ts, src/hooks/hosts/claude.ts, src/cli/index.ts, tests/integration/host-integration.test.ts, tests/integration/host-hooks.test.ts
- Modelo: gpt-5.6-sol
- Esforço: alto
- Notas: Escrever formatos nativos de MCP por projeto, preservar entradas existentes e guardar backup byte a byte para rollback/uninstall. Depende de T-020 para nenhuma mutação antes do preflight.

## T-022 — Fechar o lifecycle real e a orquestração MCP [pendente]

- Refs: US-015, AC-034, AC-035, US-016, AC-036
- Arquivos: src/cli/index.ts, src/cli/start.ts, src/cli/stop.ts, src/cli/doctor.ts, src/runtime/supervisor.ts, src/server/application.ts, tests/e2e/package-lifecycle.test.ts, tests/e2e/real-orchestration.test.ts
- Modelo: gpt-5.6-sol
- Esforço: xalto
- Notas: Conectar ao endpoint Streamable HTTP real, listar/chamar tools, usar backends instalados e garantir processos prontos antes do doctor. Depende de T-020 e T-021.

## T-023 — Automatizar matriz isolada e alinhar distribuição [pendente]

- Refs: US-016, AC-036, AC-037, AC-038
- Arquivos: package.json, package-lock.json, README.md, docs/configuration.md, docs/troubleshooting.md, scripts/test-isolated-lifecycle.mjs, .github/workflows/ci.yml, tests/contract/package-boundary.test.ts
- Modelo: gpt-5.6-terra
- Esforço: alto
- Notas: Consumir o tarball em diretórios/contêineres vazios, cobrir os cenários negativos sem depender de npm link e documentar o nome `@raffahr/mega-brain-mcp`. Depende de T-020, T-021 e T-022.
