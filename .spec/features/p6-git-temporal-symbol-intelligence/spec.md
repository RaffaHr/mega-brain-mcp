# Spec: P6 git temporal symbol intelligence

> feature: p6-git-temporal-symbol-intelligence
> status: rascunho

## Contexto

Implementa inteligência temporal baseada em Git Pickaxe (`git log -S`) para rastrear o ciclo de vida completo de símbolos, integração com a timeline ancorada do AgentMemory no `brain_history` e métricas granulares de churn por símbolo no `brain_change_context`.

## Histórias

### US-039 — Rastreamento da evolução histórica de símbolos via Git Pickaxe

Como agente de IA investigando causa raiz de problemas ou mudanças históricas, quero consultar quando um símbolo específico (função, classe) foi adicionado, alterado ou removido no repositório, para entender a evolução do código além do log linear de arquivos.

#### AC-092 — Mineração de histórico de símbolos via Git Pickaxe

- **Dado** um símbolo existente ou histórico no repositório
- **Quando** a função `gitSymbolHistory` for invocada com o identificador do símbolo
- **Então** o Git deve retornar a lista exata de commits nos quais o número de ocorrências do símbolo mudou, contendo hash, autor, data e mensagem do commit

### US-040 — Linha do tempo ancorada em episódios e sessões do AgentMemory

Como agente analisando decisões passadas, quero obter a vizinhança temporal de uma memória ou sessão através do `brain_history`, para compreender o contexto anterior e posterior que motivou determinada decisão ou bug.

#### AC-093 — Linha do tempo de episódios ancorada no brain_history

- **Dado** uma consulta ao `brain_history` com parâmetro `anchor` referenciando uma memória ou sessão
- **Quando** o handler de histórico processar a requisição
- **Então** o endpoint de timeline do AgentMemory deve ser consultado e os episódios vizinhos estruturados devem ser retornados em ordem cronológica

### US-041 — Avaliação de churn e risco concentrado por símbolo

Como agente planejando alteração em uma função específica, quero saber o índice de churn e o risco associado diretamente ao símbolo alvo no `brain_change_context`, para redobrar cuidados em áreas com alta taxa de regressão.

#### AC-094 — Alerta de risco por símbolo com alto churn histórico

- **Dado** um símbolo alvo que sofreu mais de 5 alterações recentes no histórico Git
- **Quando** `brain_change_context` for chamado para o símbolo
- **Então** o envelope de resposta deve incluir a contagem de churn do símbolo e um alerta específico de risco estrutural

## Fora de escopo

- Reescrita de commits ou operações destrutivas no Git

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-026 | O comando git log -S executa com latência sub-segundo para repositórios locais | confirmada | Validado nos testes de performance Git |

## Perguntas em aberto

Nenhuma.
