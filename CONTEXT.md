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

**Process Tree Termination**:
Cross-platform graceful and forceful termination of a process and all descendant spawned child processes (using `taskkill /F /T` on Windows and process group signals on POSIX).
_Avoid_: Single-PID kill, SIGTERM kill

**Process Verification**:
Pre-termination check validating target process executable path or command line against managed runtime paths to prevent accidental termination of recycled OS PIDs.
_Avoid_: Blind PID kill, raw PID signal

**Runtime Process Sweep**:
Proactive inspection and termination of active OS processes whose executable binary or working directory resides within the project runtime root.
_Avoid_: Process leak check, orphan polling

**Runtime Quarantine**:
Staging isolation pattern moving an active or decommissioned runtime folder into a timestamped holding path before deletion or rollback.
_Avoid_: Direct directory wipe, in-place overwrite

**Pending Delete Queue**:
Deferred deletion registry recording locked paths marked for purge upon subsequent supervisor boot or CLI runs.
_Avoid_: Stale file ignore, silent delete failure