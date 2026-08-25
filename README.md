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

Install the CLI once on the machine:

```powershell
npm install --global @raffahr/mega-brain-mcp
```

Then run project setup separately in every repository or worktree that should use
Mega Brain. The global npm package only provides the `mega-brain` command; it
does not create project runtime files, host MCP entries, hooks, AgentMemory data,
or Code Review Graph data by itself.

For local package-boundary testing before a release, build and install the same
tarball shape that npm publishes:

```powershell
npm ci
npm pack
npm install --global .\raffahr-mega-brain-mcp-0.1.1.tgz
mega-brain --help
```

`npm link` is not required.

## Set up one project

From inside the repository, or by passing `--repo`, run the guided setup. It
validates Node, Python, Git and platform support before the final confirmation.
If validation fails or you cancel before confirmation, it does not create files,
download backends or leave processes running.

```powershell
mega-brain setup --repo .
```

The default setup creates a managed local runtime for that project only. It
configures the selected host to start Mega Brain through MCP `stdio` with:

```text
mega-brain mcp --repo <absolute-project-root>
```

No manual `mega-brain start` or `mega-brain serve` is needed for normal Codex or
Claude Code use.

For CI, scripts and non-interactive terminals, use `install`. It never prompts:

```powershell
# Codex
mega-brain install --repo . --hosts codex

# Claude Code
mega-brain install --repo . --hosts claude

# Both
mega-brain install --repo . --hosts codex,claude
```

On Windows, managed AgentMemory also requires explicit acceptance of the pinned,
checksummed iii-engine artifact in the project runtime:

```powershell
mega-brain install --repo . --hosts codex,claude --accept-iii-engine
```

The interactive setup asks for this confirmation directly.

## What gets installed per project

Each configured project gets its own identity and runtime namespace. The
namespace is derived from repository, checkout and worktree identity, so two
clones or worktrees do not share data or backend processes by accident.

Project-local configuration is written to:

- `.mega-brain/config.json`

Host integration files are merged, not replaced:

- Codex MCP entry: `.codex/config.toml`
- Codex lifecycle hooks: `.codex/hooks.json`
- Claude Code MCP entry: `.mcp.json`
- Claude Code lifecycle hooks: `.claude/settings.local.json`
- Git hook multiplexer: isolated `core.hooksPath`

Existing MCP servers and hooks remain in place. The installer snapshots the
original bytes under the project's isolated Mega Brain data directory, so
`uninstall` can restore them later. The host sees only the public Mega Brain MCP
server; AgentMemory and Code Review Graph remain private adapters and should not
be added as separate host MCPs.

Runtime files live outside the repository by default under:

```text
<MEGA_BRAIN_DATA_DIR>/projects/<worktreeId>/
```

Inside that namespace Mega Brain stores the runtime lock, logs, integration
backups, provenance database, backend data and IPC state. In managed mode each
project also receives:

- isolated AgentMemory data
- isolated iii-engine files on Windows
- isolated Code Review Graph data
- four loopback AgentMemory ports: REST, streams, viewer and engine
- a private supervisor with leases for concurrent Codex or Claude sessions

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

## Managed local AgentMemory

Managed mode is the default. Mega Brain installs and starts the pinned
AgentMemory `0.9.29` runtime for the selected project, and installs Code Review
Graph `2.3.7` into the same isolated runtime namespace.

Managed mode does not require a global AgentMemory install. Backend settings are
passed only to the child runtime. Secrets and provider keys must come from the
process environment or an uncommitted `.env`; they are not written to
`.mega-brain/config.json`, runtime locks, host files, logs or setup summaries.

Expensive or external features stay off unless explicitly enabled. See
[configuration](docs/configuration.md) for `MEGA_BRAIN_ALLOW_EGRESS`,
`MEGA_BRAIN_ALLOW_LLM` and the AgentMemory environment allowlist.

## Use an existing remote AgentMemory

Remote mode does not install or start AgentMemory locally. Supply the service URL,
the name of the environment variable containing its secret, and the secret value
only through the current process environment or an uncommitted `.env`:

```powershell
$env:MEGA_BRAIN_AGENTMEMORY_MODE = 'remote'
$env:MEGA_BRAIN_AGENTMEMORY_URL = 'https://memory.example.com'
$env:MEGA_BRAIN_AGENTMEMORY_SECRET_ENV = 'REMOTE_MEMORY_SECRET'
$env:REMOTE_MEMORY_SECRET = '<secret>'
mega-brain install --repo . --hosts codex,claude
```

In remote mode Mega Brain persists only the remote URL and the secret environment
variable name. It does not install AgentMemory, start AgentMemory or install
iii-engine locally. Code Review Graph and provenance still remain isolated per
project.

Before any file or download is created, install performs a reversible namespace
A/B probe and confirms cleanup. If validation fails, fix URL/secret and rerun;
interactive setup stays on that step and also allows switching to managed mode.

No provider key, external egress, or paid LLM is enabled by default.

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

## Configuration precedence

All commands resolve configuration for the repository selected by `--repo`. The
same resolver is used by `setup`, `install`, `mcp`, `serve`, `doctor`, `upgrade`
and `uninstall`.

Precedence is:

1. CLI flags
2. process environment
3. repository `.env`
4. `--config` file or `.mega-brain/config.json`
5. built-in defaults

Relative paths such as `MEGA_BRAIN_DATA_DIR=.mega-brain-runtime` are resolved
against the selected repository root, not the shell's accidental current
directory. `MEGA_BRAIN_PORT` applies only to the explicit HTTP transport; the
default host lifecycle uses `stdio`.

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
