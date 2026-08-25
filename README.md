# Mega Brain MCP

Mega Brain MCP is a local-first knowledge control plane for software projects. It exposes six stable MCP tools while keeping AgentMemory, Code Review Graph, and Git behind versioned private adapters.

The public MCP surface is exactly `brain_recall`, `brain_learn`, `brain_change_context`, `brain_history`, `brain_validate`, and `brain_status`.

## Requirements

- Node.js `>=22.22.0` (certified on 22.22.0 and 24.19.0)
- Python `>=3.10` with `venv` and `ensurepip`
- Git
- Windows, Ubuntu, or WSL

`mega-brain install` checks every requirement before it creates runtime files, downloads backends, or changes host configuration. Managed mode then installs AgentMemory `0.9.29` and Code Review Graph `2.3.7` into a project-isolated runtime; global backend installations are not required.

## Install the package

The package name is scoped. After the release is published to npm:

```powershell
npm install --global @raffahr/mega-brain-mcp
```

Until that publication happens, build and consume the same package boundary as a tarball:

```powershell
npm ci
npm pack
npm install --global .\raffahr-mega-brain-mcp-0.1.0.tgz
mega-brain --help
```

`npm link` is not required.

## Set up Codex or Claude Code

For an interactive terminal, use the guided setup. It validates everything before
the final confirmation and defaults to a managed local runtime with strict
per-project isolation:

```powershell
mega-brain setup --repo .
```

For CI and scripts, use the deterministic non-interactive command:

```powershell
# Codex
mega-brain install --repo . --hosts codex

# Claude Code
mega-brain install --repo . --hosts claude

# Both
mega-brain install --repo . --hosts codex,claude
```

On Windows, managed AgentMemory also requires explicit acceptance of the pinned,
checksummed iii-engine artifact: add `--accept-iii-engine`. The interactive setup
asks for this confirmation directly.

Installation performs all project setup:

- Codex MCP: `.codex/config.toml`
- Codex hooks: `.codex/hooks.json`
- Claude Code MCP: `.mcp.json`
- Claude Code hooks: `.claude/settings.local.json`
- Git hook multiplexer: isolated `core.hooksPath`

Existing MCP servers and hooks remain in place. Backups are stored in the isolated Mega Brain data directory so uninstall can restore the original bytes. The host registers `mega-brain mcp --repo <root>` over `stdio`; AgentMemory and Code Review Graph remain private.

After installation, approve the project MCP/hooks when Codex (`/mcp`, `/hooks`) or Claude Code (`/mcp`) asks for project trust.

## Use and verify

Reopen the configured Codex or Claude Code project. The first MCP client starts
the private project supervisor and backends automatically; the last client to
disconnect releases its lease and the runtime shuts down after the grace period.
No manual `start` or `serve` is needed.

Use `doctor` to inspect the effective worktree identity, paths, ports and backend
health:

```powershell
mega-brain doctor --repo .
```

`start`, `stop`, and `serve` remain available as advanced
diagnostic and compatibility commands.

## Use an existing remote AgentMemory

Remote mode does not install or start AgentMemory locally. Supply the service URL,
the name of the environment variable containing its secret, and the secret only
in the process environment:

```powershell
$env:MEGA_BRAIN_AGENTMEMORY_MODE = 'remote'
$env:MEGA_BRAIN_AGENTMEMORY_URL = 'https://memory.example.com'
$env:MEGA_BRAIN_AGENTMEMORY_SECRET_ENV = 'REMOTE_MEMORY_SECRET'
$env:REMOTE_MEMORY_SECRET = '<secret>'
mega-brain install --repo . --hosts codex,claude
```

Before any file or download is created, install performs a reversible namespace
A/B probe and confirms cleanup. If validation fails, fix URL/secret and rerun;
interactive setup stays on that step and also allows switching to managed mode.

No provider key, external egress, or paid LLM is enabled by default. See [configuration](docs/configuration.md) for opt-in variables.

## Upgrade and uninstall

```powershell
mega-brain upgrade --repo .
mega-brain uninstall --repo . --hosts codex,claude
```

Normal uninstall removes the managed runtime and restores MCP/hooks while preserving project knowledge. Purge is explicit:

```powershell
mega-brain uninstall --repo . --hosts codex,claude --purge
```

Upgrade, stop, and uninstall are safe to repeat.

## Development and isolated release gates

```powershell
npm ci
npm run typecheck
npm run build
npm test
npm run benchmark
npm run test:spec
npm run audit
npm run test:isolated
npm pack --dry-run
```

`test:isolated` builds the tarball and uses disposable Docker containers to prove supported installation plus rejection of old Node, missing or pre-3.10 Python, and Python without `venv`, before any project mutation.

## License

Apache-2.0. The installed backends remain governed by their own licenses.
