# Design: Mega Brain MCP v1

## Objetivo

Entregar um único MCP instalável que componha AgentMemory, Code Review Graph e
Git sem duplicar seus bancos ou expor suas tools diretamente. Git é a verdade
atual, CRG descreve sua estrutura, AgentMemory guarda o que foi aprendido e
Mega Brain decide como consultar, validar e evoluir conhecimento.

## Topologia

- `mega-brain-mcp`: servidor TypeScript/Node 20+ com `mcp-use`, CLI e hook runner.
- AgentMemory: daemon compartilhado por usuário, acessado por REST autenticado.
- CRG: child process MCP stdio persistente por projeto, com allowlist read-only.
- Git: adapter read-only para identidade, HEAD, blobs, diffs, histórico e worktrees.
- Metadata: SQLite no data dir do usuário, particionado por checkout/worktree.
- O host registra somente o Mega Brain; os backends permanecem privados.

## Distribuição e compatibilidade

O pacote npm `mega-brain-mcp` não executa instalação no `postinstall`. O comando
explícito `mega-brain install --repo . --hosts codex,claude` cria runtimes
isolados, lock manifest e backups. A primeira matriz fixa AgentMemory 0.9.29 e
CRG 2.3.7. O scaffold deve inspecionar a versão estável instalada de `mcp-use`,
compilar contra suas declarations e travar essa versão.

Startup executa capability negotiation: REST liveness/config no AgentMemory e
`initialize` + `tools/list` no CRG. Versões ou schemas desconhecidos não são
aceitos silenciosamente. O adapter usa aliases internos somente quando um teste
de contrato comprovar equivalência.

## Configuração

Configuração própria usa `MEGA_BRAIN_*`. Os mapas
`MEGA_BRAIN_AGENTMEMORY_ENV_JSON` e `MEGA_BRAIN_CRG_ENV_JSON` encaminham apenas
valores explicitamente fornecidos. `PATH`, `NODE_OPTIONS`, `PYTHONPATH` e outras
variáveis de controle de execução são bloqueadas; executáveis, URLs, data dirs e
secrets têm overrides dedicados. O ambiente do processo vence o arquivo local,
mas toda saída usa uma visão redigida.

## Contratos públicos

As seis tools são `brain_recall`, `brain_learn`, `brain_change_context`,
`brain_history`, `brain_validate` e `brain_status`. Todas têm `inputSchema`,
`outputSchema`, `structuredContent` e conteúdo textual compacto. O envelope
comum contém schemaVersion, status, project, head, confidence, freshness,
sources, warnings e result. Resposta útil com backend ausente é `degraded`;
entrada inválida, projeto não autorizado ou ausência total de fontes é erro MCP.

## Router, ranking e budgets

- Implementation/impact: CRG e Git primeiro.
- History/decision/procedure: AgentMemory e Git primeiro.
- Architecture/workflow/debugging: ambos.
- Ranking: retrieval 30%, intent fit 20%, freshness 20%, confidence 15%,
  provenance 10% e reinforcement 5%.
- Budgets: FAST ~500, NORMAL ~1200, DEEP ~2500, todos sujeitos a teto global.
- Fallback: memória fresh suficiente, depois CRG, depois leitura tracked restrita.

## Provenance e freshness

O SQLite contém `projects`, `memory_refs`, `evidence`, `validations`,
`invalidations`, `supersessions`, `hook_events` e `backend_capabilities`. Não
armazena o texto integral da memória nem código.

Evidência referencia arquivo tracked, símbolo qualificado, blob/content hash,
commit e linhas opcionais. Hash igual mantém `FRESH`; mudança direta, working
tree relevante ou blast radius marca `POSSIBLY_STALE`; evidência removida ou
refutada marca `STALE`; afirmações atuais incompatíveis ficam `CONFLICT`; uma
substituição validada marca a anterior `DEPRECATED`.

## Hooks e lifecycle

Um dispatcher único normaliza os 6 eventos suportados pelo Codex e os 12 do
Claude Code. Ele redige o payload antes de delegar captura aos handlers oficiais
do AgentMemory e updates aos comandos oficiais do CRG. Eventos assíncronos usam
fila durável, idempotency key e debounce; falhas são fail-open e aparecem em
`brain_status`.

Git usa multiplexer para post-commit, post-checkout, post-merge e post-rewrite,
preservando o hook path anterior. Pós-commit atualiza o grafo, calcula diff,
marca invalidações e vincula sessão/commit. Uninstall restaura exatamente a
configuração anterior e preserva dados salvo purge explícito.

## Segurança

Redaction cobre `.env`, credentials, private keys, tokens, cookies,
Authorization e valores de alta entropia. O fallback de leitura resolve paths e
symlinks, aceita somente arquivos tracked sob o root real e limita bytes/linhas.
Sem opt-in não há cloud. O CRG privado não recebe tools mutantes na allowlist.
Telemetria externa é zero; métricas ficam locais.

## Fases de implementação da v1

1. Fundação e contratos: pacote, servidor, config, project registry e fixtures.
2. Runtime e adapters: installer/supervisor, AgentMemory, CRG e Git.
3. Verdade e recuperação: SQLite, freshness, `brain_status` e `brain_recall`.
4. Evolução: `brain_learn`, `brain_validate`, conflitos e supersession.
5. Mudança e tempo: `brain_change_context` e `brain_history`.
6. Lifecycle: hooks de host/Git, fila e invalidação incremental.
7. Hardening e release: segurança, benchmarks, CI, documentação, SBOM e npm.

## Fases posteriores

- v1.1: importador Obsidian com dry-run, split atômico e validação.
- v1.x: adapters adicionais de host após matriz de compatibilidade própria.
- v2: colaboração remota somente após modelo de segurança e isolamento dedicado.
