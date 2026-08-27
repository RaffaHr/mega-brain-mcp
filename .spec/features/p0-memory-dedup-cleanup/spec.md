# Spec: P0 memory dedup cleanup

> feature: p0-memory-dedup-cleanup
> status: pronta

## Contexto

Elimina poluição do vector space no AgentMemory decorrente de memórias sintéticas de reforço/conflito e garante truncamento seguro de blocos no ContextBuilder.

## Histórias

### US-026 — Despoluição de reforço e supersessão no AgentMemory

Como agente de IA, quero que o registro de reforços e supersessões atualize metadados e scores da memória existente sem criar novas strings artificiais, para que o espaço vetorial e as buscas textuais não sejam poluídos com ruído.

#### AC-070 — Reforço de memória sem geração de registro textual duplicado

- **Dado** uma memória existente no AgentMemory identificada como equivalente ou reforço de um fato observado
- **Quando** a tool `brain_learn` processar o aprendizado com relacionamento `reinforcement` ou `equivalent`
- **Então** o sistema deve atualizar o score de autoridade e metadados da memória original sem invocar `remember` com o texto sintético `"Reinforcement for memory..."`

#### AC-071 — Rastreabilidade de supersessão sem poluição do espaço vetorial

- **Dado** uma memória anterior sendo substituída por uma nova versão via parâmetro `supersedes`
- **Quando** `brain_learn` salvar a nova memória
- **Então** a supersessão deve ser registrada exclusivamente na tabela `supersessions` e metadados da nova memória, sem criar entradas de texto sintético `"Memory X superseded by Y"` no AgentMemory

### US-027 — Truncamento seguro de blocos e deduplicação semântica no Context Builder

Como agente consumindo contexto, quero que os blocos de evidência sejam empacotados e truncados em limites de sentenças/linhas sem quebra cega de caracteres, para receber payloads legíveis e sintaticamente íntegros.

#### AC-072 — Truncamento seguro de blocos de contexto respeitando limites sintáticos

- **Dado** múltiplos chunks de evidência que excedem o orçamento de tokens configurado (`FAST`, `NORMAL` ou `DEEP`)
- **Quando** `buildContextPack` empacotar as seções
- **Então** o truncamento de texto deve ocorrer em limites de linha ou bloco completo, sem truncar caracteres no meio de palavras ou fragmentar estruturas JSON/código

#### AC-073 — Deduplicação semântica normalizada antes do empacotamento

- **Dado** chunks de evidência com conteúdo textual idêntico ou equivalente após normalização NFKC e remoção de espaços
- **Quando** o Context Builder processar as evidências antes do ranqueamento
- **Então** apenas a cópia de maior confiança e frescor deve ser mantida no pacote final

## Fora de escopo

- Alteração na assinatura pública das tools MCP
- Modificação no schema SQLite de proveniência

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-020 | A API do AgentMemory 0.9.29 suporta atualização de metadados em memórias existentes sem recriação de IDs | confirmada | Validado via documentação do AgentMemory |

## Perguntas em aberto

Nenhuma.
