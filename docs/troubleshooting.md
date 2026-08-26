# Troubleshooting

## Install stops during preflight

The installer requires Node.js `>=22.22.0` and Python `>=3.10` with both
`venv` and `ensurepip`. A Git executable is required only for Git-backed hooks, history, and commit evidence; when it is absent, preflight reports Git as unavailable instead of blocking startup. It reports the detected version or missing command and
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
npm install --global .\raffahr-mega-brain-mcp-0.1.2.tgz
mega-brain --help
```

The supported package flow does not require `npm link`.

## `doctor` reports AgentMemory unavailable

Open the configured MCP once or run `mega-brain start --repo .` as an advanced
diagnostic. Readiness waits for the worktree-specific AgentMemory port shown by
`doctor`; managed mode does not assume the legacy fixed port `3111`. Inspect the
project log directory under `MEGA_BRAIN_DATA_DIR` if readiness times out.

On native Windows, rerun interactive setup and accept the pinned iii-engine, or
use `mega-brain install ... --accept-iii-engine`. The binary is downloaded from
the pinned release, checksum-verified and installed only in the project runtime;
global `PATH` is not changed.

## MCP is configured but the host shows it offline

Confirm that the host entry runs `mega-brain mcp --repo <project>` over stdio,
then reopen the host. Absolute paths are safest in host config, but `mega-brain mcp --repo .` is valid when the terminal is already in the project directory. The command logs startup progress to `stderr`; if runtime inspection fails, it now exits before starting the supervisor instead of waiting silently. In Codex, inspect `/mcp` and `/hooks` and approve project
trust. In Claude Code, inspect `/mcp` and approve the project server. A manually
running HTTP server is not required unless `--transport http` was selected.

Codex configuration is in `.codex/config.toml`; Claude Code configuration is
in `.mcp.json`. Do not register AgentMemory or Code Review Graph separately.

## Remote AgentMemory validation does not advance

Confirm the remote URL, then set an environment variable with the secret and enter only that variable name in setup. For example, in PowerShell set `$env:MEGA_BRAIN_REMOTE_SECRET = '<secret>'`, then enter `MEGA_BRAIN_REMOTE_SECRET` when setup asks for the remote secret environment variable name. The secret value itself must never be placed in config.

Setup intentionally remains on this step when the URL, authentication, namespace separation or cleanup probe fails. If health succeeds but setup reports that strict namespace isolation could not be proven, the remote service returned the sentinel written for one project when queried from another project namespace; use managed mode or fix the remote AgentMemory isolation behavior before retrying. Non-interactive install exits with `No files were changed` and must be rerun.

## Code Review Graph is behind Git HEAD

Run the project hook/update path again, then rerun `mega-brain doctor`. A
divergent graph SHA is reported as `POSSIBLY_STALE`; Mega Brain does not silently
mark graph-derived knowledge fresh.

## Git is unavailable

Mega Brain can start in a plain directory, but Git-dependent behavior is degraded until the directory is initialized as a repository. Initialize Git or pass `--repo` to an existing repository when you need Git hooks, `brain_history`, commit-backed validation, or Code Review Graph freshness against HEAD.

## Hooks do not run

Verify that the host trusts project hooks. Codex uses six lifecycle events;
Claude Code uses twelve. Mega Brain hooks fail open and queue transient backend
failures so they do not block coding-agent work.

## Upgrade or uninstall fails

Upgrade keeps the previous runtime until validation succeeds. Normal uninstall
restores Codex/Claude/Git integration and preserves project knowledge. Repeating
stop or uninstall is safe. Use `--purge` only when the retained knowledge should
also be deleted.
