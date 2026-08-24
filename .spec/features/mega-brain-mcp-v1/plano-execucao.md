# Plano de execução — mega-brain-mcp-v1

> gerado por `onp-spec plano` em 2026-08-24 18:09 — NÃO edite à mão;
> mudou tasks.md ou a config? Regenere: `onp-spec plano mega-brain-mcp-v1 --sequencial`

## Resumo — o que vai acontecer

- **modo SEQUENCIAL (escolha do usuário)**: 16 tarefa(s) pendente(s), UMA APÓS A OUTRA, na árvore principal
- sem worktrees e sem paralelismo — cada tarefa roda numa janela de contexto limpa, na ordem do tasks.md
- tudo acontece na branch de trabalho `spec/mega-brain-mcp-v1`; levar para a main é decisão sua

## Ordem de execução (uma tarefa após a outra)

| tarefa | título | modelo | esforço |
|---|---|---|---|
| T-001 | Criar pacote TypeScript, servidor MCP e harness de testes | `gpt-5.6-terra` | medium |
| T-002 | Implementar configuração tipada e registro seguro de projetos | `gpt-5.6-terra` | medium |
| T-003 | Criar fixtures e gate de compatibilidade dos backends | `gpt-5.6-sol` | high |
| T-004 | Implementar installer e supervisor de runtimes gerenciados | `gpt-5.6-sol` | high |
| T-005 | Implementar adapter REST do AgentMemory | `gpt-5.6-sol` | high |
| T-006 | Implementar adapter MCP privado do Code Review Graph | `gpt-5.6-sol` | high |
| T-007 | Implementar adapter Git e leitura tracked restrita | `gpt-5.6-sol` | high |
| T-008 | Implementar metadata SQLite, provenance e freshness | `gpt-5.6-sol` | xhigh |
| T-009 | Implementar router, ranking, context builder, recall e status | `gpt-5.6-sol` | xhigh |
| T-010 | Implementar aprendizado e validação | `gpt-5.6-sol` | xhigh |
| T-011 | Implementar contexto de mudança e histórico | `gpt-5.6-sol` | high |
| T-012 | Implementar dispatcher de hooks de Codex e Claude Code | `gpt-5.6-sol` | xhigh |
| T-013 | Implementar redaction, política de egress e métricas locais | `gpt-5.6-sol` | high |
| T-014 | Implementar multiplexer Git e invalidação incremental | `gpt-5.6-sol` | xhigh |
| T-015 | Implementar doctor, upgrade e uninstall reversíveis | `gpt-5.6-sol` | high |
| T-016 | Criar benchmark, CI, documentação e pacote de release | `gpt-5.6-terra` | high |

## Gestão de branches e commits

1. branch de trabalho `spec/mega-brain-mcp-v1` criada do ponto atual (se ainda não existir)
2. as tarefas rodam nela mesma, na ordem — **1 tarefa = 1 commit** (`T-xxx feature: título`), marcada `[concluida]` só com trabalho feito
3. gate final na branch de trabalho: `onp-spec verify mega-brain-mcp-v1` + `onp-spec audit --ci` — **exit 0 ou não está pronto**

## Como executar

### ▶ Execução — Codex headless (codex exec)

```bash
bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh
```

Cada tarefa roda `codex exec` com **janela de contexto limpa**, na árvore principal,
uma após a outra, com `--model` e `model_reasoning_effort` já definidos por tarefa e sandbox `workspace-write`.
Os prompts exatos estão embutidos no script.
Logs: `../onp-worktrees/mega-brain-mcp-mega-brain-mcp-v1-logs/`.

**Confirmação de custos — antes de executar**: os modelos e esforços por
tarefa estão nas tabelas acima; o agente CONFIRMA com o usuário se estão
dentro da licença/cota dele (modelo forte + esforço alto torra tokens).
Para gastar menos: `onp-spec plano mega-brain-mcp-v1 --modelo gpt-5.6-luna --esforco baixo`
(tudo) ou por tarefa `onp-spec tarefa mega-brain-mcp-v1 T-xxx --modelo <m> --esforco <nível>` — e regenere o plano.

### 📣 Acompanhamento — tabela + resumo no chat (a cada 1 min)

O script roda em **background**: o agente AVISA o usuário antes de iniciar e,
enquanto roda, posta no chat a cada ~1 minuto a **tabela de andamento** (qual
tarefa está rodando, qual não está, o que concluiu/falhou) junto com o
**resumo geral de andamento** (escrito por IA; sem IA, o motor resume). Ao
final, o usuário recebe o resumo completo da execução. A qualquer momento:

```bash
onp-spec resumo mega-brain-mcp-v1 --tabela   # a tabela de andamento
onp-spec resumo mega-brain-mcp-v1            # o resumo em texto
```

