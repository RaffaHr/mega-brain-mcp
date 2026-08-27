# Spec: P4 hybrid search architectural context

> feature: p4-hybrid-search-architectural-context
> status: rascunho

## Contexto

Implementa busca híbrida combinando busca lexical exata de alta performance via SQLite FTS5 (BM25) local com embeddings do AgentMemory e nós do Code Review Graph via RRF $k=60$, além de injeção automática de visão arquitetural nativa em consultas com intenção de arquitetura.

## Histórias

### US-034 — Busca lexical exata e ranking híbrido multi-fonte

Como agente de IA realizando consultas de código, quero buscar identificadores e termos literais através de um índice local SQLite FTS5 com BM25 integrado ao RRF, para que referências exatas a símbolos e funções sejam ranqueadas com máxima precisão.

#### AC-086 — Indexação FTS5 e busca lexical ponderada por BM25

- **Dado** memórias registradas com declarações, evidências e caminhos de arquivo
- **Quando** uma busca for executada através do método `searchLexical` do repositório de proveniência
- **Então** o SQLite deve retornar correspondências ordenadas por score de relevância BM25 nativo

#### AC-087 — Fusão de ranking híbrido RRF integrando canal lexical

- **Dado** consultas executadas através do `brain_recall`
- **Quando** o ranker RRF ($k=60$) agregar evidências dos canais `agentmemory`, `code_review_graph`, `git` e `provenance_lexical`
- **Então** o conjunto final retornado deve refletir a fusão de relevância e frescor de todas as quatro fontes

### US-035 — Injeção automática de visão arquitetural do projeto

Como agente de IA planejando mudanças estruturais, quero receber automaticamente uma visão geral dos módulos e conexões arquiteturais em consultas com intenção de arquitetura, para evitar alucinações sobre a topologia do projeto.

#### AC-088 — Injeção de resumo arquitetural nativo em consultas de arquitetura

- **Dado** uma chamada à tool `brain_recall` com intenção `architecture`
- **Quando** o context builder montar o pacote de contexto
- **Então** o resumo de nós e módulos gerado por `get_architecture_overview_tool` do CRG deve ser incluído nos chunks de contexto entregues

## Fora de escopo

- Busca vetorial externa proprietária em nuvem
- Substituição do analisador sintático do Tree-sitter

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-024 | O SQLite compilado pelo better-sqlite3 e node:sqlite possui suporte nativo à extensão FTS5 | confirmada | Validado nos drivers do projeto |

## Perguntas em aberto

Nenhuma.
