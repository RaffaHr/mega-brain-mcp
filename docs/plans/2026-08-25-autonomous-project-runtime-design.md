# Runtime autônomo e isolado por projeto

## Objetivo

Eliminar `start` e `serve` do fluxo comum sem compartilhar runtime, memória, grafo, credenciais ou processos entre projetos e worktrees. Codex e Claude Code iniciam `mega-brain mcp --repo <raiz>` por stdio; cada gateway usa o supervisor único já planejado para seu `worktreeId`.

## Supervisor e leases

O primeiro gateway inicia `mega-brain supervisor --repo <raiz>` como processo independente. Um manifest sem segredo publica somente protocolo, `worktreeId`, PID, IPC e timestamps. Named pipe com ACL do usuário no Windows e socket `0600` no Unix protegem o canal. O handshake valida protocolo, identidade e processo.

Cada gateway renova sua lease a cada 10 segundos. A expiração ocorre após 30 segundos e o shutdown começa 5 segundos depois da última lease. Desconexão limpa remove a lease imediatamente. Relógio e tempos são injetáveis para testes.

## Backends gerenciados e remotos

AgentMemory gerenciado recebe data dir, credencial efêmera e quatro portas exclusivas. No Windows, o instalador baixa o iii-engine fixado somente depois da confirmação, valida checksum e o mantém dentro do runtime isolado. CRG recebe `CRG_DATA_DIR` e `CRG_REPO_ROOT` absolutos em build e execução.

AgentMemory remoto não instala nem inicia AgentMemory ou iii-engine. O usuário informa URL e a variável de ambiente que contém o secret. Setup valida autenticação e executa probe reversível entre namespaces A/B, com cleanup obrigatório. Falha mantém o wizard na etapa e permite retry ou troca para managed. Install não interativo encerra sem mutações.

## Transação e provas

Preflight e validações remotas acontecem antes de downloads e escritas. Runtime, iii-engine, backends, manifests, hosts e hooks formam uma transação única com rollback completo.

Cada critério AC-039 a AC-056 terá teste `@spec:`. A matriz usa tarball em Node 22.22 e 24.19, configuração npm descartável, servidores remotos falsos ou descartáveis, relógio injetado para leases e dois projetos concorrentes. O gate final é `onp-spec verify autonomous-project-runtime` seguido de `onp-spec audit --ci` com exit code zero.
