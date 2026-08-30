# 0001. Decoupled Backend Embeddings and Project Config Persistence

Status: Partially superseded by ADR 0004 on 2026-08-30. Provider names must follow versioned target-runtime documentation; Code Review Graph 2.3.7 does not expose Voyage.

We decided to decouple AgentMemory and Code Review Graph embedding configuration in the setup wizard, support dedicated `CRG_*` variables with safe fallback, install `code-review-graph[embeddings]` in the managed venv, and persist all backend environment settings in `.mega-brain/config.json` while ensuring `.mega-brain/` is added to `.gitignore`.

## Context

AgentMemory and Code Review Graph use separate embedding engines, models, and provider APIs. Previously, embedding configuration in setup was coupled solely to AgentMemory, and credentials had split persistence constraints.

## Decision

1. **Decoupled Setup**: Separate the CLI setup into dedicated sections for AgentMemory Semantic Storage and Code Review Graph Embeddings.
2. **Supported CRG Providers**: Expose providers documented by target runtime version. For Code Review Graph 2.3.7 these are `local` (`all-MiniLM-L6-v2`), `openai` (`CRG_OPENAI_*`), `google` (`GOOGLE_API_KEY`), and `minimax` (`MINIMAX_API_KEY`).
3. **Managed Package Extra**: Install `code-review-graph[embeddings]==${version}` inside the managed virtual environment to guarantee local and cloud embedding dependencies are present.
4. **Deterministic Environment Fallback**: Map `CRG_OPENAI_API_KEY` with fallback to `OPENAI_API_KEY`, inject `CRG_ACCEPT_CLOUD_EMBEDDINGS="1"` when egress is enabled for remote providers, and enforce strict egress/LLM opt-in validation.
5. **Project Config Persistence**: Persist environment maps directly in `.mega-brain/config.json` and automatically ensure `.mega-brain/` exists in the repository's `.gitignore`.

## Consequences

- No credential collisions between memory embeddings and code graph embeddings.
- Zero-leak default: offline sentence-transformers/fastembed work without external network access.
- Local repository configuration is self-contained in `.mega-brain/config.json` and prevented from being committed.
