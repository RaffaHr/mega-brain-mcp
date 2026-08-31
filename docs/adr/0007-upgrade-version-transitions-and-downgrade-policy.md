# 0007. Upgrade Version Transitions and Downgrade Policy

Date: 2026-08-30

## Context

Upgrade progress rendered installation step labels without explicit comparison between currently installed versions, published latest versions, and targeted versions. Additionally, downgrades and custom dependency versions required clear risk warnings and user confirmation, while dependency downloads needed to remain unblocked regardless of adapter `allowEgress` settings.

## Decision

1. **Explicit Version Transitions**: Upgrade and install progress details display explicit version transitions:
   - Upgrade: `2.3.7 (current) -> 2.3.8 (latest)`
   - Downgrade: `2.3.8 (current) -> 2.3.7 (target, downgrade)`
   - Up-to-date: `2.3.7 (current, up-to-date)`
   - Fresh install: `n/a -> 2.3.8 (latest)`
2. **Strict Version Taxonomy**:
   - `current`: Version detected in active project runtime manifest or `n/a` if uninstalled;
   - `latest`: Bundled catalog default version for the release;
   - `target`: The effective version resolved for installation;
   - `n/a`: Explicit absence marker; never invent or guess fallback versions.
3. **Downgrades and Custom Versions**:
   - Downgrades are permitted whether directed by updated catalog defaults (`maintainer-directed downgrade`) or user override (`user-custom`).
   - Selecting a custom version or downgrade displays a prominent warning regarding integration risks, requiring user confirmation in interactive modes.
4. **Adapter Egress Independence**: Control-plane operations (downloading iii-engine, wheels, or virtualenv dependencies) remain functional even when adapter/runtime egress (`allowEgress=false`) is disabled.
5. **Runtime Rollback and Failure Attribution**: In transaction failures, the prior working runtime remains untouched, staging directories are purged, and the exact failing step is reported.
