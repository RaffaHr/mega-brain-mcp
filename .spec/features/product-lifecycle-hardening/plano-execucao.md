# Plano de execução — product-lifecycle-hardening

> gerado por `onp-spec plano` em 2026-08-25 00:17 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano product-lifecycle-hardening --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 4 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/product-lifecycle-hardening`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-020 | Implementar preflight sem efeitos colaterais | `gpt-5.6-sol` | high |
| T-021 | Integrar MCP e hooks de Codex e Claude Code | `gpt-5.6-sol` | high |
| T-022 | Fechar o lifecycle real e a orquestração MCP | `gpt-5.6-sol` | xhigh |
| T-023 | Automatizar matriz isolada e alinhar distribuição | `gpt-5.6-terra` | high |

## Gestão de branches e commits

1. branch de trabalho `spec/product-lifecycle-hardening` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify product-lifecycle-hardening` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Codex headless (codex exec)

```bash
bash .spec/features/product-lifecycle-hardening/executar-tarefas.sh
```

Cada tarefa roda `codex exec` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `model_reasoning_effort` já definidos por tarefa e sandbox `workspace-write`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/mega-brain-mcp-product-lifecycle-hardening-logs/`.

**Confirmação de custos — antes de executar**: os modelos e esforços por
tarefa estão nas tabelas acima; o agente CONFIRMA com o usuário se estão
dentro da licença/cota dele (modelo forte + esforço alto torra tokens).
Para gastar menos: `onp-spec plano product-lifecycle-hardening --modelo gpt-5.6-luna --esforco baixo`
(tudo) ou por tarefa `onp-spec tarefa product-lifecycle-hardening T-xxx --modelo <m> --esforco <nível>` — e regenere o plano.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo product-lifecycle-hardening --tabela   # a tabela de andamento
onp-spec resumo product-lifecycle-hardening            # o resumo em texto
```

