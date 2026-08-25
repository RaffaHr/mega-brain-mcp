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

Choose one host, or both:

```powershell
# Codex
mega-brain install --repo . --hosts codex --port 3000

# Claude Code
mega-brain install --repo . --hosts claude --port 3000

# Both
mega-brain install --repo . --hosts codex,claude --port 3000
```

Installation performs all project setup:

- Codex MCP: `.codex/config.toml`
- Codex hooks: `.codex/hooks.json`
- Claude Code MCP: `.mcp.json`
- Claude Code hooks: `.claude/settings.local.json`
- Git hook multiplexer: isolated `core.hooksPath`

Existing MCP servers and hooks remain in place. Backups are stored in the isolated Mega Brain data directory so uninstall can restore the original bytes. Only the public endpoint `http://127.0.0.1:3000/mcp` is registered; AgentMemory and Code Review Graph remain private.

After installation, approve the project MCP/hooks when Codex (`/mcp`, `/hooks`) or Claude Code (`/mcp`) asks for project trust.

## Start and verify

Run the managed backend, then the public MCP server in a second terminal:

```powershell
mega-brain start --repo .
mega-brain doctor --repo .
mega-brain serve --repo . --port 3000
```

`start` returns only after AgentMemory passes its readiness probe. `doctor` verifies the runtime lock, AgentMemory REST API, Code Review Graph MCP handshake/tool surface, and Git HEAD. The configured coding agent can then discover and call the six `brain_*` tools.

No provider key, external egress, or paid LLM is enabled by default. See [configuration](docs/configuration.md) for opt-in variables.

## Upgrade and uninstall

```powershell
mega-brain upgrade --repo .
mega-brain stop --repo .
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
