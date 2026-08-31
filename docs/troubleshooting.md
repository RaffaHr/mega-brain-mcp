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
Python is installed, select it explicitly with `mega-brain setup --python
/path/to/python3` or `MEGA_BRAIN_PYTHON=python3.12 mega-brain setup`.

## `mega-brain --help` prints nothing after a global install

Upgrade to a tarball containing the global-symlink fix, then reinstall:

```powershell
npm uninstall --global @raffahr/mega-brain-mcp
npm install --global .\raffahr-mega-brain-mcp-0.1.7.tgz
mega-brain --help
```

The supported package flow does not require `npm link`.

If managed AgentMemory on Windows requires iii-engine and `--accept-iii-engine`
was not passed, interactive install and upgrade ask for confirmation before
downloading. In non-interactive mode or `--json`, pass `--accept-iii-engine`
explicitly.

## `doctor` reports AgentMemory unavailable

Open the configured MCP once or run `mega-brain start --repo .` as an advanced
diagnostic. Readiness waits for the worktree-specific AgentMemory port shown by
`doctor`; managed mode does not assume the legacy fixed port `3111`. Inspect the
project log directory under `MEGA_BRAIN_DATA_DIR` if readiness times out.

On native Windows, rerun interactive setup and accept the pinned iii-engine, or
accept the prompt during `mega-brain setup`. The binary is downloaded from
the pinned release, checksum-verified and installed only in the project runtime;
global `PATH` is not changed.

## MCP is configured but the host shows it offline

Confirm that the host entry runs `mega-brain mcp --repo <project>` over stdio,
then reopen the host. Absolute paths are safest in host config, but `mega-brain mcp --repo .` is valid when the terminal is already in the project directory. The command logs startup progress to `stderr` only in DEBUG mode (`MEGA_BRAIN_LOG_LEVEL=debug` or `MEGA_BRAIN_DEBUG=1`); if runtime inspection fails, it exits before starting the supervisor instead of waiting silently. In Codex, inspect `/mcp` and `/hooks` and approve project
trust. In Claude Code, inspect `/mcp` and approve the project server. A manually
running HTTP server is not required unless `--transport http` was selected.

Codex configuration is in `.codex/config.toml`; Claude Code configuration is
in `.mcp.json`. Do not register AgentMemory or Code Review Graph separately.

## A shutdown left a managed runtime running

Closing the host or sending `Ctrl+C` normally stops the private supervisor and its managed backends. When that shutdown itself fails, or a supervisor detects it no longer owns the project's registration, Mega Brain writes one line to `stderr` regardless of `MEGA_BRAIN_DEBUG`: `mega-brain: <message> [project <worktreeId>]`. Treat that line as a signal that backend processes or ports may still be up, and run `mega-brain stop --repo <project>` to stop them.

## Project path is too deep for the supervisor socket

A Unix domain socket path is bounded by the OS `sun_path` size, and a project whose runtime directory is nested several levels deep can exceed it. Mega Brain then binds the supervisor socket under a dedicated `mega-brain-<hash>` directory inside the system temporary directory instead of the project runtime directory; the manifest stays in the project as usual and no action is required. If the address still does not fit even under the temporary directory, the error names the byte limit and asks to point `TMPDIR` (or the platform equivalent) at a shorter path; set that and retry.

## `Supervisor process <pid> exists but readiness failed`

Reconnecting to a registered supervisor found it unreachable. On POSIX, "is registered but its IPC endpoint is gone" means the socket was removed while the process that bound it kept running, typically a temporary-directory cleaner unlinking it; that supervisor retires itself within seconds, on its own next idle check, freeing its manifest and ports, so retry the command. If it keeps failing, the recorded pid belongs to another program: delete the stale manifest at the path named in the error and retry. On Windows a gone endpoint is instead recycled immediately and silently on the next connection attempt, since a named pipe cannot outlive the process that created it. A plain "exists but readiness failed: `<cause>`" does not self-heal on either platform; it means the endpoint answered but refused the request, so inspect `<cause>` and stop the stale supervisor process before retrying.

## Remote AgentMemory validation does not advance

Confirm the remote URL and paste the remote AgentMemory secret token when setup asks for it. Setup validates the token immediately and stores it only in this repository's local `.mega-brain/config.json`. For non-interactive install, provide the same value through `MEGA_BRAIN_AGENTMEMORY_TOKEN` or an existing local project config.
Confirm the remote URL and paste the remote AgentMemory secret token when setup asks for it. Setup validates the token immediately and stores it only in this repository's local `.mega-brain/config.json`.

Setup intentionally remains on this step when the URL, authentication, namespace separation or cleanup probe fails. If health succeeds but setup reports that strict namespace isolation could not be proven, the remote service returned the sentinel written for one project when queried from another project namespace; use managed mode or fix the remote AgentMemory isolation behavior before retrying.

## Code Review Graph is behind Git HEAD

Run the project hook/update path again, then rerun `mega-brain doctor`. Use `mega-brain doctor --json` only when a script needs the raw diagnostic envelope. A
divergent graph SHA is reported as `POSSIBLY_STALE`; Mega Brain does not silently
mark graph-derived knowledge fresh.

## Git is unavailable

Mega Brain can start in a plain directory, but Git-dependent behavior is degraded until the directory is initialized as a repository. Initialize Git or pass `--repo` to an existing repository when you need Git hooks, `brain_history`, commit-backed validation, or Code Review Graph freshness against HEAD.

## Hooks do not run

Verify that the host trusts project hooks. Codex uses six lifecycle events;
Claude Code uses twelve. Mega Brain hooks fail open and queue transient backend
failures so they do not block coding-agent work.

## Upgrade or uninstall fails

Upgrade keeps the previous runtime until validation succeeds and now renders a live progress table by default. Use `mega-brain upgrade --json` when a script needs the raw runtime inspection envelope.

Normal uninstall restores Codex/Claude/Git integration and preserves project knowledge. It also renders live checks and a final component table by default. Use `mega-brain uninstall --json` for the raw `{ dataPreserved }` envelope, and use `--purge` only when the retained knowledge should also be deleted. Repeating stop or uninstall is safe.
