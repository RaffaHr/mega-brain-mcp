# mega-brain-mcp

An autonomous MCP gateway providing persistent memory and structural codebase intelligence to AI coding agents.

## Language

**AgentMemory Embedding**:
Semantic vectorization mechanism for agent memories and observations using local fastembed or cloud embedding providers.
_Avoid_: Memory embeddings, agent vectors

**Code Review Graph Embedding**:
Vectorization mechanism for code symbols and structural graph nodes via local sentence-transformers or compatible endpoints (OpenAI, Voyage, Google Gemini, MiniMax).
_Avoid_: Graph embeddings, symbol vectors

**Network Egress**:
Explicit permission switch (`allowEgress`) required before any adapter or backend performs outbound external network requests.
_Avoid_: Internet access, external network mode

**Managed Runtime**:
Isolated, repository-scoped execution environment running pinned backend binaries with automated lifecycle supervision.
_Avoid_: Local daemon, background worker
