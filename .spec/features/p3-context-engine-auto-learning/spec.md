# Spec: P3 context engine auto learning

> feature: p3-context-engine-auto-learning
> status: pronta

## Contexto

Implementa arquitetura de aprendizado orientada a eventos Git, consolidação de memórias correlacionadas em background e diagnóstico aprofundado de observabilidade no Mega Brain MCP.

## Histórias

### US-032 — Extração e autoaprendizado a partir de commits estruturados

Como sistema cognitivo de projeto, quero aprender automaticamente regras e decisões a partir de mensagens de commit com convenção semântica e diffs estruturados, para que o cérebro evolua sem depender exclusivamente de chamadas manuais à tool `brain_learn`.

#### AC-082 — Extração automática de decisões e correções em hooks de commit

- **Dado** um novo commit disparando o hook `post-commit` com mensagem seguindo Conventional Commits (ex: `fix(auth): prevent token leak`)
- **Quando** o handler de ciclo de vida processar o evento de commit
- **Então** uma memória de tipo `bug` ou `decision` em estado `CANDIDATE` deve ser registrada na proveniência vinculada ao commit hash e arquivos modificados

#### AC-083 — Promoção automática de memórias candidatas via execuções de testes bem-sucedidas

- **Dado** memórias em estado `CANDIDATE` associadas a um commit ou arquivo
- **Quando** um evento de `tool_succeeded` confirmar a passagem dos testes da suite
- **Então** as memórias candidatas correspondentes devem ser promovidas para o estado `ACTIVE` com autoridade confirmada

### US-033 — Diagnóstico aprofundado de observabilidade e métricas de saúde

Como agente ou operador de projeto, quero obter métricas ricas de nós de grafo, distribuição de memórias por estado e taxas de acerto no `brain_status`, para avaliar com precisão a consistência do cérebro do projeto.

#### AC-084 — Exposição de métricas granulares de ciclo de vida no brain_status

- **Dado** uma chamada à tool `brain_status` com `verbose: true`
- **Quando** o status for sintetizado
- **Então** o envelope deve detalhar a contagem de nós do grafo, total de memórias ativas vs obsoletas (`ACTIVE`, `POSSIBLY_STALE`, `STALE`, `SUPERSEDED`) e taxa de latência de recuperação

#### AC-085 — Alerta de saúde quando memórias obsoletas excederem limite seguro

- **Dado** um repositório com mais de 20% das memórias em estado `STALE` ou com fila de hooks represada
- **Quando** `brain_status` for consultado
- **Então** o status do envelope deve reportar `degraded` acompanhado de alertas acionáveis no array `warnings`

## Fora de escopo

- Integração com modelos LLM em nuvem para consolidação pesada (manter tudo local-first)

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-023 | A estrutura de eventos dos hooks do Claude Code e Codex fornece payloads suficientes para correlacionar execuções de testes com arquivos | confirmada | Validado nos schemas de host hooks |

## Perguntas em aberto

Nenhuma.
