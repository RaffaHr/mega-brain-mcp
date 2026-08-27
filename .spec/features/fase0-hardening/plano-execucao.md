# Plano de execução — fase0-hardening

> gerado por `onp-spec plano` em 2026-08-27 12:23 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano fase0-hardening --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 8 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/fase0-hardening`; levar para a main é decisão sua

### Avisos

- ⚠ T-032: modelo "claude-sonnet-5" é do Claude — no codex vai rodar com "gpt-5.6-terra"
- ⚠ T-033: modelo "claude-sonnet-5" é do Claude — no codex vai rodar com "gpt-5.6-terra"
- ⚠ T-034: modelo "claude-sonnet-5" é do Claude — no codex vai rodar com "gpt-5.6-terra"
- ⚠ T-035: modelo "claude-sonnet-5" é do Claude — no codex vai rodar com "gpt-5.6-terra"
- ⚠ T-036: modelo "claude-sonnet-5" é do Claude — no codex vai rodar com "gpt-5.6-terra"
- ⚠ T-037: modelo "claude-sonnet-5" é do Claude — no codex vai rodar com "gpt-5.6-terra"
- ⚠ T-038: modelo "claude-sonnet-5" é do Claude — no codex vai rodar com "gpt-5.6-terra"
- ⚠ T-039: modelo "claude-sonnet-5" é do Claude — no codex vai rodar com "gpt-5.6-terra"

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-032 | Redação obrigatória em payloads de git hooks | `gpt-5.6-terra` | medium |
| T-033 | Fila durável com isolamento concorrente e replay | `gpt-5.6-terra` | high |
| T-034 | Deduplicação de evidências com símbolo ausente via migration v2 | `gpt-5.6-terra` | high |
| T-035 | Configuração de busy_timeout no SQLite | `gpt-5.6-terra` | medium |
| T-036 | Rebalanceamento de scores em change-context | `gpt-5.6-terra` | medium |
| T-037 | Consulta paralela a fontes em brain-recall | `gpt-5.6-terra` | medium |
| T-038 | Instrumentação de métricas em recall | `gpt-5.6-terra` | medium |
| T-039 | Parse de rename no git status | `gpt-5.6-terra` | medium |

## Gestão de branches e commits

1. branch de trabalho `spec/fase0-hardening` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify fase0-hardening` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Codex headless (codex exec)

```bash
bash .spec/features/fase0-hardening/executar-tarefas.sh
```

Cada tarefa roda `codex exec` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `model_reasoning_effort` já definidos por tarefa e sandbox `workspace-write`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/mega-brain-mcp-fase0-hardening-logs/`.

**Confirmação de custos — antes de executar**: os modelos e esforços por
tarefa estão nas tabelas acima; o agente CONFIRMA com o usuário se estão
dentro da licença/cota dele (modelo forte + esforço alto torra tokens).
Para gastar menos: `onp-spec plano fase0-hardening --modelo gpt-5.6-luna --esforco baixo`
(tudo) ou por tarefa `onp-spec tarefa fase0-hardening T-xxx --modelo <m> --esforco <nível>` — e regenere o plano.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo fase0-hardening --tabela   # a tabela de andamento
onp-spec resumo fase0-hardening            # o resumo em texto
```

