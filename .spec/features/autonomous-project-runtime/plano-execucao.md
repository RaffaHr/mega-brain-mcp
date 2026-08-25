# Plano de execução — autonomous-project-runtime

> gerado por `onp-spec plano` em 2026-08-25 03:12 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano autonomous-project-runtime`

## Resumo — o que vai acontecer

- **7 tarefa(s) pendente(s)**: 7 em 4 faixa(s) paralela(s) + 0 sequencial(is)
- **1 faixa = 1 worktree + 1 branch + 1 janela de contexto limpa** — faixas não compartilham nenhum arquivo entre si
- prefere outra seleção ou uma após a outra? Regenere com `onp-spec plano autonomous-project-runtime --paralelizar T-xxx,T-yyy` ou `--sequencial`
- tudo acontece na branch de trabalho `spec/autonomous-project-runtime`; levar para a main é decisão sua

## Faixas e ondas

### Onda 1 — faixa-1 ∥ faixa-2 ∥ faixa-3

#### faixa-1 — branch `spec/autonomous-project-runtime-faixa-1` — worktree `../onp-worktrees/mega-brain-mcp-autonomous-project-runtime-faixa-1`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-024 | Unificar configuração e resolução de caminhos | `gpt-5.6-sol` | high | `src/config/schema.ts`, `src/config/load.ts`, `src/config/project-config.ts`, `src/runtime/layout.ts`, `tests/unit/config.test.ts`, `tests/unit/project-identity.test.ts`, `.env.example` |
| T-027 | Criar o assistente interativo de setup | `gpt-5.6-terra` | high | `src/cli/setup.ts`, `src/cli/prompts.ts`, `src/cli/index.ts`, `src/config/project-config.ts`, `tests/integration/setup.test.ts`, `tests/fixtures/setup-answers.ts` |

#### faixa-2 — branch `spec/autonomous-project-runtime-faixa-2` — worktree `../onp-worktrees/mega-brain-mcp-autonomous-project-runtime-faixa-2`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-025 | Implementar supervisor por projeto, IPC e leases | `gpt-5.6-sol` | xhigh | `src/runtime/project-supervisor.ts`, `src/runtime/ipc.ts`, `src/runtime/leases.ts`, `src/runtime/supervisor.ts`, `src/runtime/types.ts`, `tests/integration/project-supervisor.test.ts`, `tests/security/path-boundary.test.ts` |

#### faixa-3 — branch `spec/autonomous-project-runtime-faixa-3` — worktree `../onp-worktrees/mega-brain-mcp-autonomous-project-runtime-faixa-3`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-026 | Expor MCP stdio autônomo e adaptar os hosts | `gpt-5.6-sol` | xhigh | `src/cli/mcp.ts`, `src/server/stdio.ts`, `src/server/application.ts`, `src/cli/host-integration.ts`, `src/hooks/hosts/codex.ts`, `src/hooks/hosts/claude.ts`, `tests/integration/stdio-mcp.test.ts`, `tests/integration/host-integration.test.ts` |
| T-028 | Tornar instalação, upgrade e rollback uma transação única | `gpt-5.6-sol` | xhigh | `src/runtime/transaction.ts`, `src/cli/install.ts`, `src/cli/upgrade.ts`, `src/cli/uninstall.ts`, `src/cli/host-hooks.ts`, `src/cli/host-integration.ts`, `tests/integration/install-transaction.test.ts`, `tests/integration/runtime-manager.test.ts` |
| T-029 | Garantir isolamento físico dos backends | `gpt-5.6-sol` | xhigh | `src/cli/install.ts`, `src/cli/start.ts`, `src/cli/doctor.ts`, `src/adapters/agentmemory/client.ts`, `src/adapters/agentmemory/capabilities.ts`, `src/adapters/code-review-graph/client.ts`, `src/adapters/code-review-graph/capabilities.ts`, `src/compatibility/manifest.ts`, `tests/contract/agentmemory.test.ts`, `tests/contract/code-review-graph.test.ts`, `tests/integration/backend-isolation.test.ts` |

### Onda 2 — faixa-4

#### faixa-4 — branch `spec/autonomous-project-runtime-faixa-4` — worktree `../onp-worktrees/mega-brain-mcp-autonomous-project-runtime-faixa-4`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-030 | Provar lifecycle autônomo, concorrência e matriz completa | `gpt-5.6-sol` | xhigh | `tests/e2e/autonomous-lifecycle.test.ts`, `tests/e2e/concurrent-projects.test.ts`, `tests/e2e/package-lifecycle.test.ts`, `scripts/test-isolated-lifecycle.mjs`, `tests/contract/package-boundary.test.ts`, `.github/workflows/ci.yml`, `README.md`, `docs/configuration.md`, `docs/troubleshooting.md`, `package.json` |

## Gestão de branches e commits

1. branch de trabalho `spec/autonomous-project-runtime` criada do ponto atual (se ainda não existir)
2. cada faixa nasce dela como branch própria e roda no seu worktree — **1 tarefa = 1 commit** (`T-xxx feature: título`)
3. terminou a onda → merge `--no-ff` de cada faixa de volta, na ordem; conflito interrompe a faixa e pede resolução humana
4. faixa mesclada → worktree removido, branch apagada, tarefa marcada `[concluida]` no tasks.md
5. gate final na branch de trabalho: `onp-spec verify autonomous-project-runtime` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Codex headless (codex exec)

```bash
bash .spec/features/autonomous-project-runtime/executar-tarefas.sh
```

Cada faixa roda `codex exec` com **janela de contexto limpa**, no seu worktree, com
`--model` e `model_reasoning_effort` já definidos por tarefa e sandbox `workspace-write`. Os prompts exatos estão
embutidos no script — quer rodar uma faixa na mão, é só copiá-los de lá.
Logs: `../onp-worktrees/mega-brain-mcp-autonomous-project-runtime-logs/`.

**Confirmação de custos — antes de executar**: os modelos e esforços por
tarefa estão nas tabelas acima; o agente CONFIRMA com o usuário se estão
dentro da licença/cota dele (modelo forte + esforço alto torra tokens).
Para gastar menos: `onp-spec plano autonomous-project-runtime --modelo gpt-5.6-luna --esforco baixo`
(tudo) ou por tarefa `onp-spec tarefa autonomous-project-runtime T-xxx --modelo <m> --esforco <nível>` — e regenere o plano.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo autonomous-project-runtime --tabela   # a tabela de andamento
onp-spec resumo autonomous-project-runtime            # o resumo em texto
```
