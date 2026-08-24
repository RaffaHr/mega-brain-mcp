# Tasks: Configuração de runtime do AgentMemory

> feature: agentmemory-runtime-config

## T-017 — Modelar perfis remoto e gerenciado [pendente]

- Refs: US-011, AC-026, AC-027, AC-028
- Arquivos: src/config/schema.ts, src/config/load.ts, tests/unit/config.test.ts, .env.example, docs/configuration.md
- Modelo: gpt-5.6-sol
- Esforço: alto
- Notas: Ler o `.env` do repositório com precedência inferior ao ambiente; usar allowlist explícita; manter configuração local fora do modo remoto; validar e redigir credenciais e recursos com custo/egress.

## T-018 — Propagar configuração somente ao runtime gerenciado [pendente]

- Refs: US-011, AC-026, AC-027, AC-028
- Arquivos: src/cli/index.ts, src/cli/install.ts, src/cli/start.ts, src/cli/upgrade.ts, src/runtime/lock-manifest.ts, src/runtime/supervisor.ts, src/runtime/types.ts, tests/integration/runtime-manager.test.ts, tests/e2e/lifecycle.test.ts
- Modelo: gpt-5.6-sol
- Esforço: alto
- Notas: O modo remoto pula instalação/start local. O modo gerenciado injeta o ambiente apenas em memória no spawn; nenhum secret entra no runtime-lock. Dependência: T-017.

## T-019 — Certificar Node 22.22+ e atualizar a matriz [pendente]

- Refs: US-012, AC-029
- Arquivos: package.json, package-lock.json, README.md, docs/troubleshooting.md, .github/workflows/ci.yml, .github/workflows/release.yml, tests/contract/node-compatibility.test.ts
- Modelo: gpt-5.6-terra
- Esforço: medio
- Notas: Declarar `>=22.22.0`, testar Node 22.22 e 24.19 e manter a auditoria de produção limpa sem rebaixar dependências. Dependência: nenhuma.
