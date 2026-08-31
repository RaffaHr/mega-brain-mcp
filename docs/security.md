# Security model

Mega Brain is local-first and deny-by-default.

Setup stores accepted secrets as plaintext in local `.mega-brain/config.json` by explicit security decision: restricted local permissions, `.gitignore`, `git ls-files` verification, and redaction. Mega Brain does not invent encryption. Runtime locks, manifests, state, logs, summaries, diagnostics, and errors never store secret values.

- Only six `brain_*` tools are public. The CRG adapter accepts an exact eight-tool read-only allowlist.
- Adapter/provider egress is denied unless `MEGA_BRAIN_ALLOW_EGRESS=true`; LLM use additionally requires `MEGA_BRAIN_ALLOW_LLM=true`. Dependency downloads for setup and upgrade remain independent.
- Learning, hooks, logs, diagnostics, and configuration views redact authorization headers, cookies, credentials, private keys, known token formats, and high-entropy secret candidates.
- Direct file fallback accepts only tracked files whose resolved path remains inside the selected repository, with byte and line limits.
- Provenance SQLite stores references, hashes, states, and validation records—not source code or full memory content.
- Managed dependency installation is explicit and transactional; package installation has no `postinstall` downloader.
- Hooks preserve pre-existing entries and are fail-open. Mega Brain failures do not replace the exit status of an existing Git hook.

Treat the AgentMemory bearer token and any backend environment map as secrets. Run `mega-brain doctor` after changing authentication or backend versions.
