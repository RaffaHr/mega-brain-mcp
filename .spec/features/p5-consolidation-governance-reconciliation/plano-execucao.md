# Plano de execução — p5-consolidation-governance-reconciliation

> gerado por `onp-spec plano` em 2026-08-27 18:33 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano p5-consolidation-governance-reconciliation`

## Resumo — o que vai acontecer

- **3 tarefa(s) pendente(s)**: 3 em 1 faixa(s) paralela(s) + 0 sequencial(is)
- **1 faixa = 1 worktree + 1 branch + 1 janela de contexto limpa** — faixas não compartilham nenhum arquivo entre si
- prefere outra seleção ou uma após a outra? Regenere com `onp-spec plano p5-consolidation-governance-reconciliation --paralelizar T-xxx,T-yyy` ou `--sequencial`
- tudo acontece na branch de trabalho `spec/p5-consolidation-governance-reconciliation`; levar para a main é decisão sua

## Faixas e ondas

### Onda 1 — faixa-1

#### faixa-1 — branch `spec/p5-consolidation-governance-reconciliation-faixa-1` — worktree `../onp-worktrees/mega-brain-mcp-p5-consolidation-governance-reconciliation-faixa-1`

| tarefa | título | modelo | esforço | arquivos |
|---|---|---|---|---|
| T-055 | Implementar motor determinístico de consolidação e supersessão de memórias | `claude-sonnet-5` | medium | `src/learning/consolidation.ts`, `src/provenance/repository.ts`, `test/p5-consolidation-governance-reconciliation.spec.test.js` |
| T-056 | Implementar expurgo de governança para arquivos deletados no Git | `claude-sonnet-5` | medium | `src/lifecycle/governance.ts`, `src/hooks/dispatcher.ts`, `src/server/application.ts`, `test/p5-consolidation-governance-reconciliation.spec.test.js` |
| T-057 | Implementar reconciliação em lote de memórias POSSIBLY_STALE | `claude-sonnet-5` | medium | `src/lifecycle/revalidation.ts`, `src/provenance/freshness.ts`, `src/server/application.ts`, `test/p5-consolidation-governance-reconciliation.spec.test.js` |

## Gestão de branches e commits

1. branch de trabalho `spec/p5-consolidation-governance-reconciliation` criada do ponto atual (se ainda não existir)
2. cada faixa nasce dela como branch própria e roda no seu worktree — **1 tarefa = 1 commit** (`T-xxx feature: título`)
3. terminou a onda → merge `--no-ff` de cada faixa de volta, na ordem; conflito interrompe a faixa e pede resolução humana
4. faixa mesclada → worktree removido, branch apagada, tarefa marcada `[concluida]` no tasks.md
5. gate final na branch de trabalho: `onp-spec verify p5-consolidation-governance-reconciliation` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Claude Code headless

```bash
bash .spec/features/p5-consolidation-governance-reconciliation/executar-tarefas.sh
```

Cada faixa roda `claude -p` com **janela de contexto limpa**, no seu worktree, com
`--model` e `--effort` já definidos por tarefa e permissões `acceptEdits`. Os prompts exatos estão
embutidos no script — quer rodar uma faixa na mão, é só copiá-los de lá.
Logs: `../onp-worktrees/mega-brain-mcp-p5-consolidation-governance-reconciliation-logs/`.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo p5-consolidation-governance-reconciliation --tabela   # a tabela de andamento
onp-spec resumo p5-consolidation-governance-reconciliation            # o resumo em texto
```

