# Configuration

Mega Brain reads `.env` from the repository selected by `--repo`. Configuration
precedence is CLI flags, process environment, repository `.env`, JSON
configuration file, then built-in defaults. Keep the real `.env` uncommitted; `.env.example` contains
only safe defaults and empty credential placeholders.

## AgentMemory profiles

`MEGA_BRAIN_AGENTMEMORY_MODE` controls who owns the AgentMemory runtime:

- `managed` (default): Mega Brain installs and starts the pinned local runtime.
  Recognized AgentMemory variables are passed to that child process in memory.
- `remote`: Mega Brain connects with `MEGA_BRAIN_AGENTMEMORY_URL` and the secret
  referenced by `MEGA_BRAIN_AGENTMEMORY_SECRET_ENV`. It does not install or
  start AgentMemory locally, does not forward local settings or provider
  credentials, and lifecycle commands never manage the remote service.

In managed mode, `AGENTMEMORY_SECRET` is also used as the local REST bearer token
when `MEGA_BRAIN_AGENTMEMORY_TOKEN` is empty. An explicit Mega Brain token always
wins. Neither value belongs in a committed file or a runtime lock manifest.

## Mega Brain variables

| Variable | Purpose | Default |
|---|---|---|
| `MEGA_BRAIN_DATA_DIR` | Runtime, metadata, logs, and queues | user data directory |
| `MEGA_BRAIN_PORT` | HTTP MCP port | `3000` |
| `MEGA_BRAIN_AGENTMEMORY_MODE` | `managed` or `remote` ownership profile | `managed` |
| `MEGA_BRAIN_AGENTMEMORY_URL` | AgentMemory REST base URL | `http://127.0.0.1:3111` |
| `MEGA_BRAIN_AGENTMEMORY_SECRET_ENV` | Name of the environment variable containing the remote secret | unset |
| `MEGA_BRAIN_AGENTMEMORY_TOKEN` | Bearer token for AgentMemory | unset |
| `MEGA_BRAIN_AGENTMEMORY_ENV_JSON` | Advanced allowlisted environment map for managed mode | `{}` |
| `MEGA_BRAIN_CRG_COMMAND` | Code Review Graph executable override | managed executable |
| `MEGA_BRAIN_CRG_ARGS_JSON` | JSON array of CRG arguments | managed arguments |
| `MEGA_BRAIN_CRG_ENV_JSON` | Allowlisted environment passed to CRG | `{}` |
| `MEGA_BRAIN_ALLOW_EGRESS` | Permit non-loopback network access and remote providers | `false` |
| `MEGA_BRAIN_ALLOW_LLM` | Permit LLM consumption; also requires egress | `false` |

## Managed AgentMemory allowlist

Direct variables override duplicate entries in
`MEGA_BRAIN_AGENTMEMORY_ENV_JSON`. Unknown direct variables are ignored; unknown
keys in the JSON map are rejected. The explicit allowlist is:

- Runtime and behavior: `AGENTMEMORY_AGENT_SCOPE`,
  `AGENTMEMORY_ALLOW_AGENT_SDK`, `AGENTMEMORY_AUTO_COMPRESS`,
  `AGENTMEMORY_CONSOLIDATION_COOLDOWN_MS`, `AGENTMEMORY_DATA_DIR`,
  `AGENTMEMORY_DEBUG`, `AGENTMEMORY_DROP_STALE_INDEX`,
  `AGENTMEMORY_EXPORT_ROOT`, `AGENTMEMORY_FOLLOWUP_WINDOW_SECONDS`,
  `AGENTMEMORY_FORCE_PROXY`, `AGENTMEMORY_GRAPH_WEIGHT`,
  `AGENTMEMORY_IMAGE_EMBEDDINGS`, `AGENTMEMORY_IMAGE_STORE_MAX_BYTES`,
  `AGENTMEMORY_INJECT_CONTEXT`, `AGENTMEMORY_LLM_NOTHINK`,
  `AGENTMEMORY_LLM_TIMEOUT_MS`, `AGENTMEMORY_METRICS_PORT`,
  `AGENTMEMORY_PROBE_TIMEOUT_MS`, `AGENTMEMORY_PROJECT_NAME`,
  `AGENTMEMORY_PROVIDER`, `AGENTMEMORY_REFLECT`, `AGENTMEMORY_SLOTS`,
  `AGENTMEMORY_SUPPRESS_COST_WARNING`, `AGENTMEMORY_TOOLS`,
  `AGENTMEMORY_VERBOSE`, `AGENTMEMORY_VIEWER_HOST`, and
  `AGENTMEMORY_VIEWER_URL`.
- Runtime setup: `AGENTMEMORY_DOCKER_GID`,
  `AGENTMEMORY_DOCKER_SKIP_CHOWN`, `AGENTMEMORY_DOCKER_UID`,
  `AGENTMEMORY_III_CONFIG`, `AGENTMEMORY_III_VERSION`, and
  `AGENTMEMORY_USE_DOCKER`.
- Authentication and providers: `AGENTMEMORY_SECRET`, `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `VOYAGE_API_KEY`, and `COHERE_API_KEY`.
- Feature switches used by AgentMemory hooks/providers: `EMBEDDING_PROVIDER`,
  `GRAPH_EXTRACTION_ENABLED`, `CONSOLIDATION_ENABLED`, and `SNAPSHOT_ENABLED`.

`PATH`, `NODE_OPTIONS`, `PYTHONPATH`, loader variables, home-directory
variables, shell-control variables, and every non-allowlisted key are rejected
from explicit backend environment maps.

## Egress and LLM opt-ins

The zero-LLM local configuration needs no provider key. The loader refuses
settings that could spend tokens or contact a provider unless the corresponding
global opt-ins are present:

- `VOYAGE_API_KEY` and `COHERE_API_KEY` require
  `MEGA_BRAIN_ALLOW_EGRESS=true`.
- `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AGENTMEMORY_AUTO_COMPRESS`,
  `AGENTMEMORY_INJECT_CONTEXT`, `AGENTMEMORY_REFLECT`,
  `GRAPH_EXTRACTION_ENABLED`, and `CONSOLIDATION_ENABLED` require both
  `MEGA_BRAIN_ALLOW_EGRESS=true` and `MEGA_BRAIN_ALLOW_LLM=true`.
- A non-local `EMBEDDING_PROVIDER` requires egress.

Diagnostics redact bearer tokens, `AGENTMEMORY_SECRET`, and provider API keys.

Each Git checkout/worktree receives separate AgentMemory data, iii-engine, CRG
data, provenance, IPC and four backend ports in managed mode. Remote AgentMemory
is accepted only after its namespace A/B probe proves that one worktree cannot
read another and confirms sentinel cleanup.

## Host integration files

`mega-brain setup` guides interactive configuration. `mega-brain install` is the
non-interactive equivalent and never prompts. `mega-brain install --hosts codex` merges the public server into
`.codex/config.toml` and native lifecycle hooks into `.codex/hooks.json`.
`mega-brain install --hosts claude` merges the same public server into
`.mcp.json` and hooks into `.claude/settings.local.json`. Passing
`--hosts codex,claude` configures both.

The default host entry is the `mega-brain mcp --repo <root>` command over stdio.
HTTP remains opt-in through `--transport http`; only then does
`MEGA_BRAIN_PORT` select the public endpoint. AgentMemory and Code Review Graph
are private adapters and must not be added to either host.

The first install stores byte-preserving backups below
`MEGA_BRAIN_DATA_DIR/projects/<worktree>/integration-backups`. Repeated install
updates the single managed entry without replacing unrelated configuration.
Normal uninstall restores those backups; `--purge` additionally deletes
project knowledge after restoration.

Codex may require project trust before loading `.codex/config.toml` or hooks;
inspect with `/mcp` and `/hooks`. Claude Code exposes project MCP approval
through `/mcp`.
