# Spec: P1 native tool capabilities

> feature: p1-native-tool-capabilities
> status: pronta

## Contexto

Aproveita capacidades nativas profundas de busca semântica em nós AST do Code Review Graph, geração nativa de blocos de contexto no AgentMemory e fusão RRF (Reciprocal Rank Fusion) para eliminar ranking manual arbitrário.

## Histórias

### US-028 — Busca semântica de nós no Code Review Graph

Como agente desenvolvendo ou investigando arquitetura, quero localizar funções, classes e módulos por similaridade semântica no grafo do CRG, para encontrar componentes mesmo sem saber o nome exato dos arquivos ou símbolos.

#### AC-074 — Utilização da tool semantic_search_nodes_tool em consultas de arquitetura

- **Dado** uma consulta de `brain_recall` com intenção `architecture` ou `implementation`
- **Quando** o adaptador do Code Review Graph for acionado
- **Então** ele deve consultar `semantic_search_nodes_tool` além de `get_minimal_context_tool` e converter os nós retornados em chunks de evidência estruturada

#### AC-075 — Enriquecimento de contexto com busca de fluxos afetados em símbolos específicos

- **Dado** uma consulta à tool `brain_change_context` com um símbolo ou método alvo
- **Quando** o adaptador do Code Review Graph processar o impacto
- **Então** `get_flow_tool` deve ser consultado para extrair a cadeia de chamadores diretos e indiretos do símbolo

### US-029 — Ranking via Reciprocal Rank Fusion (RRF) e busca híbrida

Como motor de contexto, quero ranquear chunks de múltiplas fontes via Reciprocal Rank Fusion (RRF com constante k=60) e peso de frescor, para garantir que as evidências mais relevantes e atuais apareçam no topo do pacote de contexto.

#### AC-076 — Ranqueamento híbrido RRF entre AgentMemory, CRG e Git

- **Dado** chunks de evidência retornados simultaneamente por AgentMemory, Code Review Graph e Git
- **Quando** o motor de ranking calcular a relevância de cada chunk
- **Então** as posições relativas em cada lista devem ser combinadas através da fórmula RRF multiplicada pelo fator de frescor (`FRESH` = 1.0, `POSSIBLY_STALE` = 0.6, `STALE` = 0.1)

#### AC-077 — Inclusão de lições consolidadas no smartSearch do AgentMemory

- **Dado** uma consulta de `brain_recall`
- **Quando** `smartSearch` for chamado no cliente do AgentMemory
- **Então** o parâmetro `includeLessons: true` deve ser enviado para mesclar aprendizados duradouros nas respostas

## Fora de escopo

- Invalidação baseada em árvore sintática AST (escopo da P2)
- Reanálise de acoplamento temporal no Git (escopo da P2)

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-021 | O Code Review Graph 2.3.7 expõe a tool semantic_search_nodes_tool com retorno em formato estruturado JSON | confirmada | Validado no manifest crg-2.3.7.json |

## Perguntas em aberto

Nenhuma.
