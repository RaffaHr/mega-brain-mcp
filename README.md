# Mega Brain MCP

Mega Brain MCP is a local-first knowledge control plane for software projects. It exposes six stable MCP tools while keeping AgentMemory, Code Review Graph, and Git behind versioned private adapters.

## What v1 provides

- Evidence-aware recall with `FAST`, `NORMAL`, and `DEEP` budgets.
- Learning, validation, conflicts, reinforcement, and supersession without erasing history.
- Change context combining current graph structure with remembered rules, bugs, decisions, and risks.
- Git-backed temporal history and deterministic freshness states.
- Fail-open Codex, Claude Code, and Git hook primitives with idempotent durable queues.
- Explicit managed installation of AgentMemory `0.9.29` and Code Review Graph `2.3.7`; no dependency installation in `postinstall`.
- Local operation by default. External egress and LLM use require separate opt-ins.

The public MCP surface is exactly: `brain_recall`, `brain_learn`, `brain_change_context`, `brain_history`, `brain_validate`, and `brain_status`.

## Requirements

- Node.js `>=22.22.0` (the supported CI matrix covers 22.22.0 and 24.19.0)
- Python `3.10+`
- Git
- Windows, Ubuntu, or WSL

## Install and run

```powershell
npm install --global mega-brain-mcp
mega-brain install --repo . --hosts codex,claude
mega-brain start --repo .
mega-brain serve --port 3000
```

Configure your MCP host to use the Streamable HTTP endpoint `http://127.0.0.1:3000/mcp`. Register only Mega Brain; do not register its internal backends in the host.

The install command merges fail-open capture hooks into `.codex/hooks.json` and `.claude/settings.local.json`, installs a Git hook multiplexer, and stores byte-for-byte backups for uninstall. Existing hook entries remain in place.

On native Windows, AgentMemory can run but its engine setup requires Docker Desktop or a manual engine; the official one-command engine path is WSL2/Linux. `mega-brain doctor` reports the resulting backend failure instead of silently falling back.

Run a real compatibility check after installation:

```powershell
mega-brain doctor --repo .
```

Upgrade is transactional. Standard uninstall removes the runtime but preserves project knowledge; `--purge` is explicit:

```powershell
mega-brain upgrade --repo .
mega-brain uninstall --repo .
mega-brain uninstall --repo . --purge
```

## Configuration

All first-party settings use `MEGA_BRAIN_*`. Backend environment maps are passed through `MEGA_BRAIN_AGENTMEMORY_ENV_JSON` and `MEGA_BRAIN_CRG_ENV_JSON`, with execution-control variables blocked. See [configuration](docs/configuration.md), [security](docs/security.md), and [troubleshooting](docs/troubleshooting.md).

## Development and release gates

```powershell
npm ci
npm run build
npm test
npm run benchmark
npm run test:spec
npm run audit
npm pack --dry-run
```

The authoritative project audit is also run with the ONP skill engine as `onp-spec audit --ci` before a release is declared complete.

## License

Apache-2.0. The embedded backends remain governed by their own licenses.
