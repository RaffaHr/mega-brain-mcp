# Troubleshooting

## `doctor` reports AgentMemory unavailable

Confirm `mega-brain start --repo .` is running, the REST URL is loopback or explicitly allowed, and `MEGA_BRAIN_AGENTMEMORY_TOKEN` matches `AGENTMEMORY_SECRET`. The default REST endpoint is `http://127.0.0.1:3111`.

On native Windows, start Docker Desktop or use WSL2 before starting AgentMemory; its automatic engine setup is not supported as a native-Windows one-command path.

## Code Review Graph is behind Git HEAD

Run the project hook/update path again, then rerun `mega-brain doctor`. A divergent graph SHA is reported as `POSSIBLY_STALE`; Mega Brain does not silently mark graph-derived knowledge fresh.

## Hooks do not run

Verify the host trusts project hooks and that its supported event names match the compatibility matrix. Codex v1 uses six events; Claude Code uses the twelve AgentMemory lifecycle events. Hook failures are queued and should not block the host.

## Install or upgrade fails

Check Node/Python versions and local package-index access. Upgrade restores the previous runtime if post-install validation fails. Data is kept during normal uninstall.

## Node prints `EBADENGINE`

Use Node `20.20+` or `22.22+`. Earlier Node 22 releases may execute locally but are outside the supported dependency range.
