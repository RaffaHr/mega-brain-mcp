# 0005. Separate Adapter Egress from Dependency Downloads

Date: 2026-08-30

We decided that `allowEgress` governs outbound requests made by managed adapters to LLM and embedding providers, while setup and upgrade may independently download pinned dependencies and query registries. The separation preserves local-first runtime behavior without blocking required control-plane installation work, and reports provider egress failures separately from dependency or registry availability failures.
