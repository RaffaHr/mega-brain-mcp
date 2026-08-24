# Configuration

Configuration precedence is environment, configuration file, then built-in defaults. Secrets should be supplied through the environment, not committed files.

| Variable | Purpose | Default |
|---|---|---|
| `MEGA_BRAIN_DATA_DIR` | Runtime, metadata, logs, and queues | user data directory |
| `MEGA_BRAIN_PORT` | HTTP MCP port | `3000` |
| `MEGA_BRAIN_AGENTMEMORY_URL` | AgentMemory REST base URL | `http://127.0.0.1:3111` |
| `MEGA_BRAIN_AGENTMEMORY_TOKEN` | Bearer token for AgentMemory | unset |
| `MEGA_BRAIN_AGENTMEMORY_ENV_JSON` | Allowlisted environment passed to AgentMemory | `{}` |
| `MEGA_BRAIN_CRG_COMMAND` | Code Review Graph executable override | managed executable |
| `MEGA_BRAIN_CRG_ARGS_JSON` | JSON array of CRG arguments | managed arguments |
| `MEGA_BRAIN_CRG_ENV_JSON` | Allowlisted environment passed to CRG | `{}` |
| `MEGA_BRAIN_ALLOW_EGRESS` | Permit non-loopback network access | `false` |
| `MEGA_BRAIN_ALLOW_LLM` | Permit LLM consumption; also requires egress | `false` |

`PATH`, `NODE_OPTIONS`, `PYTHONPATH`, loader variables, home-directory variables, and shell-control variables are rejected from backend environment maps. Use dedicated command, URL, data-directory, and authentication settings instead.

Each Git checkout/worktree receives a separate runtime identity. AgentMemory may be shared by the user, while CRG data and Mega Brain provenance remain checkout-scoped.
