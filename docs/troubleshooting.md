# Troubleshooting

## Install stops during preflight

The installer requires Node.js `>=22.22.0`, Git, and Python `>=3.10` with both
`venv` and `ensurepip`. It reports the detected version or missing command and
ends with `No files were changed` before runtime, downloads, MCP configuration,
or hooks are created.

Verify the same commands in the target shell:

```powershell
node --version
npm --version
git --version
python --version
python -c "import ensurepip, venv"
```

On Debian/Ubuntu, install the matching `python3-venv` package. If more than one
Python is installed, select it explicitly with `mega-brain install --python
/path/to/python3`.

## `mega-brain --help` prints nothing after a global install

Upgrade to a tarball containing the global-symlink fix, then reinstall:

```powershell
npm uninstall --global @raffahr/mega-brain-mcp
npm install --global .\raffahr-mega-brain-mcp-0.1.0.tgz
mega-brain --help
```

The supported package flow does not require `npm link`.

## `doctor` reports AgentMemory unavailable

Run `mega-brain start --repo .` first. It waits up to 60 seconds for
`/agentmemory/health`; inspect the project log directory under
`MEGA_BRAIN_DATA_DIR` if readiness times out. Confirm that
`MEGA_BRAIN_AGENTMEMORY_TOKEN` matches `AGENTMEMORY_SECRET` when authentication
is enabled. The default REST endpoint is `http://127.0.0.1:3111`.

On native Windows, AgentMemory's engine may require Docker Desktop or WSL2.
Mega Brain reports that backend failure instead of enabling egress or a paid
provider silently.

## MCP is configured but the host shows it offline

Keep `mega-brain serve --repo . --port 3000` running and verify
`http://127.0.0.1:3000/mcp`. The install port and serve port must match. In
Codex, inspect `/mcp` and `/hooks` and approve project trust. In Claude Code,
inspect `/mcp` and approve the project server.

Codex configuration is in `.codex/config.toml`; Claude Code configuration is
in `.mcp.json`. Do not register AgentMemory or Code Review Graph separately.

## Code Review Graph is behind Git HEAD

Run the project hook/update path again, then rerun `mega-brain doctor`. A
divergent graph SHA is reported as `POSSIBLY_STALE`; Mega Brain does not silently
mark graph-derived knowledge fresh.

## Hooks do not run

Verify that the host trusts project hooks. Codex uses six lifecycle events;
Claude Code uses twelve. Mega Brain hooks fail open and queue transient backend
failures so they do not block coding-agent work.

## Upgrade or uninstall fails

Upgrade keeps the previous runtime until validation succeeds. Normal uninstall
restores Codex/Claude/Git integration and preserves project knowledge. Repeating
stop or uninstall is safe. Use `--purge` only when the retained knowledge should
also be deleted.
