# Plano de execução — autonomous-project-runtime

> gerado por `onp-spec plano` em 2026-08-25 13:09 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano autonomous-project-runtime --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 4 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal (3 já concluída(s): T-024, T-025, T-029)
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/autonomous-project-runtime`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-026 | Expor MCP stdio autônomo e adaptar os hosts | `gpt-5.6-sol` | xhigh |
| T-027 | Criar o assistente interativo de setup | `gpt-5.6-terra` | high |
| T-028 | Tornar instalação, upgrade e rollback uma transação única | `gpt-5.6-sol` | xhigh |
| T-030 | Provar lifecycle autônomo, concorrência e matriz completa | `gpt-5.6-sol` | xhigh |

## Gestão de branches e commits

1. branch de trabalho `spec/autonomous-project-runtime` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify autonomous-project-runtime` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Codex headless (codex exec)

```bash
bash .spec/features/autonomous-project-runtime/executar-tarefas.sh
```

Cada tarefa roda `codex exec` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `model_reasoning_effort` já definidos por tarefa e sandbox `workspace-write`.
Os prompts exatos estão embutidos no script.
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

