# 0002. Resilient Runtime Lifecycle, Process-Tree Termination, and Partial State Reconciliation

We decided to enforce cross-platform process-tree termination (`taskkill /F /T` on Windows, process groups on POSIX), process metadata verification against PID recycling, runtime process sweeps by path, lazy pending-delete deferred cleanup, canonical directory-path identity for non-git projects, and auto-healing via `mega-brain doctor --fix`.

## Context

On Windows and POSIX systems, backend services (`agentmemory` spawning `iii-engine`, Python `code-review-graph` worker processes) spawn descendant child processes. Calling single-PID `process.kill(pid, 'SIGTERM')` orphaned child processes, holding file handles on `runtime/current` and causing `EPERM` / `EACCES` rename errors during `setup`, `upgrade`, and `uninstall`. Additionally, partial installations (missing workspace config, deleted non-git markers, or corrupted runtime state) caused operations to fail unrecoverably.

## Decision

1. **Process-Tree Termination**: Implement process stopper executing `taskkill /F /T /PID <pid>` on Windows and negative PID process group signals (`-pid`) on POSIX to guarantee all child workers and engine binaries are fully terminated.
2. **Process Verification**: Prior to terminating any PID, verify process metadata (executable path and command line) against `layout.projectRoot` / `layout.runtimeRoot` or known binary signatures to prevent killing unrelated processes after OS PID recycling.
3. **Runtime Process Sweep**: Before performing runtime swaps, quarantines, or uninstallation, query OS processes whose executable path or working directory is located under `layout.runtimeRoot` and terminate them.
4. **Pending-Delete Deferred Cleanup**: When filesystem locks or Windows search/antivirus indexers temporarily prevent directory removal during uninstallation or quarantine swap, fall back to best-effort file removal and queue remaining paths in a `.pending-delete` registry for cleanup on every CLI execution.
5. **Canonical Non-Git Identity**: Derive non-git project identity deterministically from the canonical absolute path of the workspace directory, ensuring consistent `worktreeId` resolution even if `.mega-brain/` was deleted.
6. **Self-Healing and CLI Doctor**: Automatically drain pending deletions on all CLI commands, and provide `mega-brain doctor --fix` to terminate orphaned runtime processes and unblock locked resources.
7. **Dual-State Reconciliation**: Anchor project identity to `worktreeId`. Allow `uninstall` to proceed with data purging even if `.mega-brain/config.json` was deleted by the user. Enforce that `upgrade` without an existing installation fails fast with guidance to run `setup` (unless `--init` is passed).
8. **Progressive Retry with Attribute Reset**: Update filesystem retry logic to strip Read-Only flags and Windows file attributes before attempting deletion or rename operations.

## Consequences

- Completely eliminates orphaned background engine processes holding open handles on runtime directories.
- `uninstall`, `upgrade`, and `setup` succeed reliably across Windows and Linux without manual Task Manager intervention.
- Repositories with partially deleted configuration files or broken setups can be cleanly repaired, re-setup, or uninstalled without manual folder surgery.