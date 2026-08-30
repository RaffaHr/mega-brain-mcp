# mega-brain-mcp

An autonomous MCP gateway providing persistent memory and structural codebase intelligence to AI coding agents.

## Language

**AgentMemory Embedding**:
Semantic vectorization mechanism for agent memories and observations using local fastembed or cloud embedding providers.
_Avoid_: Memory embeddings, agent vectors

**Code Review Graph Embedding**:
Vectorization mechanism for code symbols and structural graph nodes via local sentence-transformers or Code Review Graph 2.3.7 providers (OpenAI-compatible, Google Gemini, MiniMax).
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

**Runtime Permission Preservation**:
Attribute cleanup before rename or deletion preserves executable permission bits and does not follow symbolic links into unrelated targets.
_Avoid_: chmod 0666 on runtime binaries

**Pending Delete Queue**:
Deferred deletion registry recording locked paths marked for purge upon subsequent supervisor boot or CLI runs.
_Avoid_: Stale file ignore, silent delete failure
## Setup Configuration

**Mega Brain Project**:
A repository installation with a valid Mega Brain manifest, compatible worktree identity, and isolated runtime directories. A Git repository or derived ID alone is not a Mega Brain Project.
_Avoid_: Detected project, Git project

**Effective Configuration**:
Typed values selected for runtime use after defaults, existing values, user choices, and explicit overrides are resolved.
_Avoid_: Raw config, prompt answers

**Configuration Source**:
The reason an effective value exists: `default`, `user`, `existing`, or `inferred`.
_Avoid_: Origin text, provenance log

**Configuration Status**:
The state of a setting: `applied`, `unset`, `skipped`, or `configured`.
_Avoid_: Boolean success, enabled flag

**Configuration Consent**:
Explicit record of user acceptance for egress, LLM use, cloud providers, or custom dependency versions.
_Avoid_: Implicit opt-in, remembered warning

**Environment Catalog**:
Versioned Mega Brain metadata describing configurable backend variables, defaults, allowed values, secrets, consumers, and dependencies.
_Avoid_: Environment dump, backend guess

**Consumer Selection**:
Explicit mapping that determines which managed child process may receive a configured secret.
_Avoid_: Credential broadcast, provider autodetection

**Runtime Secret Boundary**:
The rule that secrets may exist in local project configuration but never in runtime locks, manifests, staging metadata, host files, logs, diagnostics, errors, progress details, or summaries.
_Avoid_: Secret-safe runtime, hidden credentials

**Adapter Egress**:
Network permission for managed adapters and external LLM or embedding providers. It does not describe dependency downloads or registry access.
_Avoid_: Global network lock, internet mode

**Dependency Download**:
Control-plane retrieval of managed packages, binaries, or engine versions during setup or upgrade. It is independent from Adapter Egress.
_Avoid_: Provider request, backend egress

**Registry Availability**:
Whether a package or dependency version source can be reached and queried during setup or upgrade.
_Avoid_: Egress health, provider health

**Temporary Health Probe**:
A short-lived managed backend process started only to validate an already provisioned project, then terminated with guaranteed cleanup.
_Avoid_: Persistent doctor daemon, reused backend

**Custom Dependency Version**:
A target version selected outside the current Mega Brain catalog default, requiring operation-specific risk acceptance.
_Avoid_: Unsupported version, permanent consent
