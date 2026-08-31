# 0003. Local Configuration Secret Boundary

Date: 2026-08-30

We decided to persist required setup secrets only in the repository-local `.mega-brain/config.json`, protect that directory with restricted permissions and `.gitignore` verification, and inject each secret only into explicitly selected managed child processes. Mega Brain never writes, migrates, or removes repository `.env` content, and secrets never enter runtime locks, manifests, host files, diagnostics, logs, or summaries. This keeps the local configuration boundary explicit without inventing custom encryption.
