# Plano de execução — p6-git-temporal-symbol-intelligence

> gerado por `onp-spec plano` em 2026-08-27 18:33 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano p6-git-temporal-symbol-intelligence`

## Resumo — o que vai acontecer

- **3 tarefa(s) pendente(s)**: 3 em 1 faixa(s) paralela(s) + 0 sequencial(is)
- **1 faixa = 1 worktree + 1 branch + 1 janela de contexto limpa** — faixas não compartilham nenhum arquivo entre si
- prefere outra seleção ou uma após a outra? Regenere com `onp-spec plano p6-git-temporal-symbol-intelligence --paralelizar T-xxx,T-yyy` ou `--sequencial`
- tudo acontece na branch de trabalho `spec/p6-git-temporal-symbol-intelligence`; levar para a main é decisão sua

## Faixas e ondas

### Onda 1 — faixa-1

#### faixa-1 — branch `spec/p6-git-temporal-symbol-intelligence-faixa-1` — worktree `../onp-worktrees/mega-brain-mcp-p6-git-temporal-symbol-intelligence-faixa-1`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-058 | Implementar mineração de histórico por símbolo com Git Pickaxe | `claude-sonnet-5` | medium | `src/adapters/git/history.ts`, `src/tools/brain-history.ts`, `test/p6-git-temporal-symbol-intelligence.spec.test.js` |
| T-059 | Integrar timeline ancorada do AgentMemory no brain_history | `claude-sonnet-5` | medium | `src/server/application.ts`, `src/tools/brain-history.ts`, `test/p6-git-temporal-symbol-intelligence.spec.test.js` |
| T-060 | Implementar contagem de churn e alerta de risco por símbolo no brain_change_context | `claude-sonnet-5` | medium | `src/orchestration/change-context.ts`, `src/tools/brain-change-context.ts`, `src/server/application.ts`, `test/p6-git-temporal-symbol-intelligence.spec.test.js` |

## Gestão de branches e commits

1. branch de trabalho `spec/p6-git-temporal-symbol-intelligence` criada do ponto atual (se ainda não existir)
2. cada faixa nasce dela como branch própria e roda no seu worktree — **1 tarefa = 1 commit** (`T-xxx feature: título`)
3. terminou a onda → merge `--no-ff` de cada faixa de volta, na ordem; conflito interrompe a faixa e pede resolução humana
4. faixa mesclada → worktree removido, branch apagada, tarefa marcada `[concluida]` no tasks.md
5. gate final na branch de trabalho: `onp-spec verify p6-git-temporal-symbol-intelligence` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/p6-git-temporal-symbol-intelligence/executar-tarefas.sh
```

Cada faixa roda `claude -p` com **janela de contexto limpa**, no seu worktree, com
`--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`. Os prompts exatos estão
embutidos no script — quer rodar uma faixa na mão, é só copiá-los de lá.
Logs: `../onp-worktrees/mega-brain-mcp-p6-git-temporal-symbol-intelligence-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo p6-git-temporal-symbol-intelligence --tabela   # a tabela de andamento
onp-spec resumo p6-git-temporal-symbol-intelligence            # o resumo em texto
```

