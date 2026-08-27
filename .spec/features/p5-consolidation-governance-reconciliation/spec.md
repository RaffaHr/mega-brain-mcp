# Spec: P5 consolidation governance reconciliation

> feature: p5-consolidation-governance-reconciliation
> status: rascunho

## Contexto

Implementa motor determinístico de consolidação de memórias para reduzir context pollution, expurgo governado no AgentMemory (`governanceDelete`) para arquivos deletados e reconciliação proativa em lote de memórias com status `POSSIBLY_STALE`.

## Histórias

### US-036 — Consolidação determinística de memórias correlacionadas

Como cérebro cognitivo do projeto, quero consolidar automaticamente múltiplas memórias granulares do mesmo módulo/arquivo em sínteses arquiteturais preservando proveniência e histórico de supersessão, para manter o contexto conciso e evitar flooding de memórias antigas.

#### AC-089 — Agrupamento e síntese determinística de memórias do mesmo escopo

- **Dado** múltiplas memórias ativas associadas ao mesmo caminho de arquivo e tipo de conhecimento
- **Quando** o motor de consolidação processar o conjunto de memórias
- **Então** uma memória consolidada deve ser gerada e as memórias anteriores devem ser marcadas como substituídas com registro na tabela `supersessions`

### US-037 — Governança e expurgo de memórias órfãs de arquivos deletados

Como administrador do conhecimento do projeto, quero que memórias atreladas exclusivamente a arquivos removidos do repositório sejam expurgadas do AgentMemory via `governanceDelete`, para que agentes não recebam instruções sobre componentes inexistentes.

#### AC-090 — Expurgo de memórias vinculadas a arquivos removidos no Git

- **Dado** um commit ou reconciliação que remove permanentemente arquivos do repositório
- **Quando** o handler de governança processar os caminhos deletados
- **Então** as memórias correspondentes devem ser expurgadas via chamada `governanceDelete` no AgentMemory e marcadas como `DEPRECATED` na proveniência

### US-038 — Reconciliação proativa em lote de memórias sob suspeita de obsolescência

Como agente consumindo memórias, quero que memórias marcadas como `POSSIBLY_STALE` sejam reavaliadas proativamente contra a árvore de código, para que o estado retorne a `FRESH` se o símbolo não foi alterado ou mude para `STALE` se o corpo da função foi modificado.

#### AC-091 — Reconciliação proativa de integridade de AST

- **Dado** memórias com estado `POSSIBLY_STALE` na proveniência
- **Quando** a rotina de reconciliação em lote for executada
- **Então** as memórias cujo hash AST de símbolo estiver intacto devem retornar para `FRESH` (confiança 1.0) e as que sofreram modificação no corpo devem transicionar para `STALE`

## Fora de escopo

- Expurgo irreversível sem log de auditoria em `invalidations`
- Alteração destrutiva de histórico Git

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-025 | O endpoint governanceDelete do AgentMemory remove com segurança IDs de memória sem corromper o índice vetorial | confirmada | Validado nos testes de schema do client AgentMemory |

## Perguntas em aberto

Nenhuma.
