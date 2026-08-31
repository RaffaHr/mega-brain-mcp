# 0006. Doctor Diagnostic Probes and Provisioning Detection

Date: 2026-08-30

## Context

Running `mega-brain doctor` on unprovisioned checkouts was deriving a project ID from Git metadata and reporting false component failures (`Unavailable` / `Degraded`), even when the checkout was simply an initialized repository where setup had not yet run. In addition, health checks did not distinguish between unprovisioned repositories, unconfigured backends, and active runtime degradation.

## Decision

1. **Explicit Provisioning Boundary**: A directory is only treated as a Mega Brain Project when a valid runtime lock and manifest exist in the project data directory. Plain Git checkouts report `Project: Not provisioned`.
2. **Not Applicable Checks for Unmanaged Checkouts**: In unprovisioned repositories, project isolation checks, ports, storage paths, and managed backend probes are marked as `Not applicable` without triggering false warnings. Git repository, host hooks, and runtime prerequisites continue to be validated.
3. **Temporary Health Probes**: For provisioned projects, health checks execute temporary background probes with strict timeouts and guaranteed cleanup via `try/finally` blocks. Reusing lingering daemons or persisting probe ports/storage is forbidden.
4. **Granular Health Taxonomy**: Component health status reports granular details:
   - Process: `OK` | `Failed`
   - Endpoint: `OK` | `Failed`
   - Version: `OK` | `Unknown` | `Mismatch`
   - Capabilities: `OK` | `Partial`
   - Aggregated status: `Healthy` | `Degraded` | `Unavailable` | `Not applicable` | `Not configured`.
5. **Disabled Backends**: When a backend component is explicitly disabled or not configured in project settings, doctor reports `Not configured` rather than `Unavailable`.
