#!/usr/bin/env bash
# executar-tarefas.sh — gerado por `onp-spec plano mega-brain-mcp-v1` em 2026-08-24 18:31
# NÃO edite à mão: mudou tasks.md ou a config, regenere o plano.
#
# uso:
#   bash executar-tarefas.sh                  tudo (ondas → sequenciais → gate)
#   bash executar-tarefas.sh --faixa <id>     reexecuta UMA faixa (+ merge + gate)
#   bash executar-tarefas.sh --seq <T-xxx>    reexecuta UMA tarefa sequencial
#   bash executar-tarefas.sh --gate           só o gate (verify + audit)
#   bash executar-tarefas.sh --listar         mostra faixas, tarefas e estados
#   (acrescente --sem-gate para não rodar o gate ao final)
#
# resumo do que está rolando, a qualquer momento: onp-spec resumo mega-brain-mcp-v1
set -u
set -o pipefail

RUN_ID='mega-brain-mcp-mega-brain-mcp-v1-mt7kod3j'
FEATURE='mega-brain-mcp-v1'
BASE_BRANCH='spec/mega-brain-mcp-v1'
ENGINE="${ONP_SPEC_ENGINE:-$HOME/.agents/skills/onp-spec-driven/scripts/onp-spec.mjs}"
CODEX_FLAGS=(--sandbox 'workspace-write')
STREAM_FLAGS=(--json)
FALHAS=""
COM_GATE=1
RESUMO_MODEL='gpt-5.6-luna'
RESUMO_PID=""

verde()    { printf '\033[32m%s\033[0m\n' "$*"; }
vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
amarelo()  { printf '\033[33m%s\033[0m\n' "$*"; }
info()     { printf '· %s\n' "$*"; }
falhar()   { vermelho "✘ $*"; exit 1; }

# eventos vão para o ledger GLOBAL (~/.onp-spec/painel/ledger.jsonl):
# um arquivo para todos os projetos, é o que o onp-spec resumo lê
evento() { node "$ENGINE" evento --run "$RUN_ID" "$@" >/dev/null 2>&1 || true; }

# ── ambiente (todos os modos passam por aqui) ────────────────────────
preparar_ambiente() {
  command -v git >/dev/null 2>&1 || falhar "git não encontrado"
  command -v node >/dev/null 2>&1 || falhar "node não encontrado"
  command -v codex >/dev/null 2>&1 || falhar "Codex CLI (codex) não encontrado — instale-o ou siga o modo manual em plano-execucao.md"
  TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null) || falhar "fora de um repositório git"
  cd "$TOPLEVEL" || exit 1
  # artefatos recém-gerados pelo `onp-spec plano` são sujeira esperada:
  # se forem a ÚNICA sujeira, o script mesmo commita; qualquer outra, aborta
  if [ -n "$(git status --porcelain)" ]; then
    if [ -z "$(git status --porcelain | grep -v -e 'plano-execucao\.' -e 'plano\.json' -e 'executar-tarefas\.sh')" ]; then
      git add -A
      git commit -q -m "plano de execução: $FEATURE (artefatos gerados)"
      info "artefatos do plano commitados"
    else
      falhar "árvore suja além dos artefatos do plano — commite ou faça git stash antes (os worktrees partem do último commit)"
    fi
  fi
  git ls-files --error-unmatch -- '.spec/features/mega-brain-mcp-v1/spec.md' >/dev/null 2>&1 || falhar "spec.md não está commitada — os worktrees das faixas precisam dela no git"
  ATUAL=$(git rev-parse --abbrev-ref HEAD)
  [ "$ATUAL" != "HEAD" ] || falhar "HEAD destacado — troque para uma branch"
  if [ "$ATUAL" != "$BASE_BRANCH" ]; then
    if git show-ref --verify --quiet "refs/heads/$BASE_BRANCH"; then
      git checkout -q "$BASE_BRANCH" || falhar "não consegui trocar para $BASE_BRANCH"
    else
      git checkout -q -b "$BASE_BRANCH" || falhar "não consegui criar $BASE_BRANCH"
    fi
    info "branch de trabalho: $BASE_BRANCH (a partir de $ATUAL)"
  fi
  git worktree prune
  LOG_DIR="$(dirname "$TOPLEVEL")/onp-worktrees/mega-brain-mcp-mega-brain-mcp-v1-logs"
  WT_BASE="$(dirname "$TOPLEVEL")/onp-worktrees/mega-brain-mcp-mega-brain-mcp-v1"
  STREAMS_DIR="${ONP_SPEC_HOME:-$HOME/.onp-spec}/painel/streams/$RUN_ID"
  mkdir -p "$LOG_DIR" "$STREAMS_DIR"
}

# worktree limpo mesmo depois de uma tentativa que falhou
preparar_worktree() { # $1=faixa $2=branch $3=worktree
  git worktree prune
  if [ -e "$3" ]; then git worktree remove --force "$3" >/dev/null 2>&1; rm -rf "$3"; fi
  if git show-ref --verify --quiet "refs/heads/$2"; then git branch -D "$2" >/dev/null 2>&1; fi
  git worktree add "$3" -b "$2" >/dev/null 2>&1 || { vermelho "✘ não consegui criar o worktree de $1 em $3"; return 1; }
}

tentativa() { # $1=faixa — conta reexecuções (vai para o ledger)
  local arq="$LOG_DIR/.tentativa-$1"
  local n=1
  [ -f "$arq" ] && n=$(( $(cat "$arq") + 1 ))
  printf "%s" "$n" > "$arq"
  printf "%s" "$n"
}

# uma tarefa = uma sessão codex exec headless com contexto limpo.
# o JSONL da sessão vira o stream da tarefa no ledger
rodar_tarefa() { # $1=escopo(faixa|seq) $2=T-xxx $3=prompt $4=modelo $5=esforço
  local chave="$1--$2"
  local stream="$STREAMS_DIR/$chave.jsonl"
  evento --tipo tarefa --tarefa "$2" --faixa "$1" --estado executando --stream "$chave"
  info "$2 — codex exec ($4 · $5) · stream: $chave"
  # --add-dir: o .git compartilhado dos worktrees mora no repo principal —
  # sem ele o sandbox workspace-write bloquearia o commit da tarefa
  if codex exec "$3" --model "$4" -c model_reasoning_effort="$5" "${STREAM_FLAGS[@]}" "${CODEX_FLAGS[@]}" --add-dir "$TOPLEVEL" > "$stream" 2>>"$LOG_DIR/$1.log"; then
    evento --tipo tarefa --tarefa "$2" --faixa "$1" --estado concluida --stream "$chave"
    node "$ENGINE" stream-resumo "$RUN_ID" "$chave" 2>/dev/null || true
    return 0
  fi
  evento --tipo tarefa --tarefa "$2" --faixa "$1" --estado falhou --stream "$chave"
  node "$ENGINE" stream-resumo "$RUN_ID" "$chave" 2>/dev/null || true
  return 1
}

mesclar_faixa() { # $1=faixa $2=branch $3=worktree $4=exit-da-faixa
  if [ "$4" -ne 0 ]; then
    evento --tipo faixa --faixa "$1" --estado falhou
    vermelho "✘ $1 falhou (log: $LOG_DIR/$1.log) — worktree mantido para inspeção: $3"
    amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --faixa $1"
    FALHAS="$FALHAS $1"; return 1
  fi
  evento --tipo faixa --faixa "$1" --estado mesclando
  if git merge --no-ff "$2" -m "merge $1 ($FEATURE)"; then
    git worktree remove --force "$3" >/dev/null 2>&1
    git branch -d "$2" >/dev/null 2>&1
    evento --tipo faixa --faixa "$1" --estado mesclada
    verde "✔ $1 mesclada em $BASE_BRANCH"
  else
    git merge --abort >/dev/null 2>&1
    evento --tipo faixa --faixa "$1" --estado conflito
    vermelho "✘ conflito ao mesclar $1 — resolva na mão: git merge $2 (worktree mantido: $3)"
    FALHAS="$FALHAS $1"; return 1
  fi
}

marcar_concluidas() { # $@=T-xxx
  for t in "$@"; do node "$ENGINE" tarefa "$FEATURE" "$t" concluida >/dev/null || true; done
}

# ── resumo geral de andamento: 1/min enquanto a execução roda ─────────
# escrito por IA (codex exec somente leitura) com fallback do motor; vai
# para o terminal e para o ledger — o agente repassa o texto no chat.
gerar_resumo() {
  local ctx ia
  ctx=$(node "$ENGINE" resumo "$FEATURE" --contexto 2>/dev/null) || ctx=""
  [ -n "$ctx" ] || return 0
  ia=$(codex exec "Você narra, para o dono do produto, uma execução de tarefas de código em andamento. Estado mecânico:

$ctx

Escreva o RESUMO GERAL DE ANDAMENTO: um parágrafo único de 2 a 4 frases, em português simples, dizendo o que está acontecendo agora, o que já terminou, o que falhou e se o usuário precisa agir. Sem markdown, sem listas." --model "$RESUMO_MODEL" --sandbox read-only --ephemeral 2>/dev/null)
  if [ -n "$ia" ]; then
    node "$ENGINE" resumo "$FEATURE" --gravar --origem ia --texto "$ia" >/dev/null 2>&1 || true
    printf '\n📣 resumo (IA): %s\n' "$ia"
  else
    node "$ENGINE" resumo "$FEATURE" --gravar >/dev/null 2>&1 || true
    printf '\n📣 resumo: %s\n' "$(node "$ENGINE" resumo "$FEATURE" 2>/dev/null)"
  fi
}

# mata o loop E o sleep filho — senão o sleep herda o stdout e quem chamou
# o script via pipe fica esperando EOF por até 60s depois do exit
parar_resumos() {
  [ -n "$RESUMO_PID" ] || return 0
  command -v pkill >/dev/null 2>&1 && pkill -P "$RESUMO_PID" 2>/dev/null
  kill "$RESUMO_PID" 2>/dev/null
  RESUMO_PID=""
}

iniciar_resumos() {
  ( while :; do sleep 60; gerar_resumo; done ) &
  RESUMO_PID=$!
  # ao sair: para o loop e grava um último resumo (o estado final, do motor)
  trap 'parar_resumos; node "$ENGINE" resumo "$FEATURE" --gravar >/dev/null 2>&1 || true' EXIT
}

# ── sequencial T-003 (ordem do tasks.md) ──
executar_seq_T_003() {
  info 'sequencial T-003 — Criar fixtures e gate de compatibilidade dos backends'
  if rodar_tarefa seq 'T-003' 'Você executa UMA tarefa da feature "mega-brain-mcp-v1" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/mega-brain-mcp-v1/spec.md, .spec/features/mega-brain-mcp-v1/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-003 — "Criar fixtures e gate de compatibilidade dos backends"
  critérios/refs: US-001, US-006, US-009
  arquivos permitidos (e seus testes): compatibility/agentmemory-0.9.29.json, compatibility/crg-2.3.7.json, src/compatibility/manifest.ts, src/compatibility/negotiate.ts, tests/contract/compatibility.test.ts
  mensagem de commit: "T-003 mega-brain-mcp-v1: Criar fixtures e gate de compatibilidade dos backends"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/vitest-results.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'gpt-5.6-sol' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-003 mega-brain-mcp-v1: Criar fixtures e gate de compatibilidade dos backends (auto-commit do plano)'
    fi
    marcar_concluidas T-003
    verde "✔ T-003 concluída"
    return 0
  fi
  vermelho "✘ T-003 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --seq T-003"
  FALHAS="$FALHAS T-003"
  return 1
}

# ── sequencial T-004 (ordem do tasks.md) ──
executar_seq_T_004() {
  info 'sequencial T-004 — Implementar installer e supervisor de runtimes gerenciados'
  if rodar_tarefa seq 'T-004' 'Você executa UMA tarefa da feature "mega-brain-mcp-v1" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/mega-brain-mcp-v1/spec.md, .spec/features/mega-brain-mcp-v1/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-004 — "Implementar installer e supervisor de runtimes gerenciados"
  critérios/refs: AC-001 (Instalação cria runtime isolado e verificável)
  arquivos permitidos (e seus testes): src/cli/install.ts, src/cli/start.ts, src/cli/stop.ts, src/runtime/layout.ts, src/runtime/supervisor.ts, src/runtime/lock-manifest.ts, tests/integration/runtime-manager.test.ts
  mensagem de commit: "T-004 mega-brain-mcp-v1: Implementar installer e supervisor de runtimes gerenciados"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/vitest-results.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'gpt-5.6-sol' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-004 mega-brain-mcp-v1: Implementar installer e supervisor de runtimes gerenciados (auto-commit do plano)'
    fi
    marcar_concluidas T-004
    verde "✔ T-004 concluída"
    return 0
  fi
  vermelho "✘ T-004 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --seq T-004"
  FALHAS="$FALHAS T-004"
  return 1
}

# ── sequencial T-005 (ordem do tasks.md) ──
executar_seq_T_005() {
  info 'sequencial T-005 — Implementar adapter REST do AgentMemory'
  if rodar_tarefa seq 'T-005' 'Você executa UMA tarefa da feature "mega-brain-mcp-v1" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/mega-brain-mcp-v1/spec.md, .spec/features/mega-brain-mcp-v1/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-005 — "Implementar adapter REST do AgentMemory"
  critérios/refs: US-002, US-003, US-006
  arquivos permitidos (e seus testes): src/adapters/agentmemory/client.ts, src/adapters/agentmemory/schemas.ts, src/adapters/agentmemory/capabilities.ts, tests/contract/agentmemory.test.ts
  mensagem de commit: "T-005 mega-brain-mcp-v1: Implementar adapter REST do AgentMemory"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/vitest-results.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'gpt-5.6-sol' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-005 mega-brain-mcp-v1: Implementar adapter REST do AgentMemory (auto-commit do plano)'
    fi
    marcar_concluidas T-005
    verde "✔ T-005 concluída"
    return 0
  fi
  vermelho "✘ T-005 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --seq T-005"
  FALHAS="$FALHAS T-005"
  return 1
}

# ── sequencial T-006 (ordem do tasks.md) ──
executar_seq_T_006() {
  info 'sequencial T-006 — Implementar adapter MCP privado do Code Review Graph'
  if rodar_tarefa seq 'T-006' 'Você executa UMA tarefa da feature "mega-brain-mcp-v1" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/mega-brain-mcp-v1/spec.md, .spec/features/mega-brain-mcp-v1/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-006 — "Implementar adapter MCP privado do Code Review Graph"
  critérios/refs: US-002, US-004, US-005, US-006
  arquivos permitidos (e seus testes): src/adapters/code-review-graph/client.ts, src/adapters/code-review-graph/allowlist.ts, src/adapters/code-review-graph/schemas.ts, tests/contract/code-review-graph.test.ts
  mensagem de commit: "T-006 mega-brain-mcp-v1: Implementar adapter MCP privado do Code Review Graph"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/vitest-results.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'gpt-5.6-sol' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-006 mega-brain-mcp-v1: Implementar adapter MCP privado do Code Review Graph (auto-commit do plano)'
    fi
    marcar_concluidas T-006
    verde "✔ T-006 concluída"
    return 0
  fi
  vermelho "✘ T-006 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --seq T-006"
  FALHAS="$FALHAS T-006"
  return 1
}

# ── sequencial T-007 (ordem do tasks.md) ──
executar_seq_T_007() {
  info 'sequencial T-007 — Implementar adapter Git e leitura tracked restrita'
  if rodar_tarefa seq 'T-007' 'Você executa UMA tarefa da feature "mega-brain-mcp-v1" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/mega-brain-mcp-v1/spec.md, .spec/features/mega-brain-mcp-v1/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-007 — "Implementar adapter Git e leitura tracked restrita"
  critérios/refs: AC-020 (Leitura direta permanece dentro do repositório autorizado)
  arquivos permitidos (e seus testes): src/adapters/git/repository.ts, src/adapters/git/blobs.ts, src/adapters/git/history.ts, src/adapters/git/safe-read.ts, tests/integration/git-adapter.test.ts, tests/security/path-boundary.test.ts
  mensagem de commit: "T-007 mega-brain-mcp-v1: Implementar adapter Git e leitura tracked restrita"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/vitest-results.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'gpt-5.6-sol' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-007 mega-brain-mcp-v1: Implementar adapter Git e leitura tracked restrita (auto-commit do plano)'
    fi
    marcar_concluidas T-007
    verde "✔ T-007 concluída"
    return 0
  fi
  vermelho "✘ T-007 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --seq T-007"
  FALHAS="$FALHAS T-007"
  return 1
}

# ── sequencial T-008 (ordem do tasks.md) ──
executar_seq_T_008() {
  info 'sequencial T-008 — Implementar metadata SQLite, provenance e freshness'
  if rodar_tarefa seq 'T-008' 'Você executa UMA tarefa da feature "mega-brain-mcp-v1" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/mega-brain-mcp-v1/spec.md, .spec/features/mega-brain-mcp-v1/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-008 — "Implementar metadata SQLite, provenance e freshness"
  critérios/refs: AC-010 (Mudança não relacionada preserva memória válida), AC-011 (Mudança direta, indireta ou não commitada invalida confiança), AC-012 (Remoção, contradição e substituição têm estados distintos)
  arquivos permitidos (e seus testes): src/provenance/database.ts, src/provenance/migrations.ts, src/provenance/repository.ts, src/provenance/freshness.ts, src/provenance/conflicts.ts, tests/integration/freshness.test.ts
  mensagem de commit: "T-008 mega-brain-mcp-v1: Implementar metadata SQLite, provenance e freshness"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/vitest-results.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'gpt-5.6-sol' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-008 mega-brain-mcp-v1: Implementar metadata SQLite, provenance e freshness (auto-commit do plano)'
    fi
    marcar_concluidas T-008
    verde "✔ T-008 concluída"
    return 0
  fi
  vermelho "✘ T-008 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --seq T-008"
  FALHAS="$FALHAS T-008"
  return 1
}

# ── sequencial T-009 (ordem do tasks.md) ──
executar_seq_T_009() {
  info 'sequencial T-009 — Implementar router, ranking, context builder, recall e status'
  if rodar_tarefa seq 'T-009' 'Você executa UMA tarefa da feature "mega-brain-mcp-v1" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/mega-brain-mcp-v1/spec.md, .spec/features/mega-brain-mcp-v1/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-009 — "Implementar router, ranking, context builder, recall e status"
  critérios/refs: AC-004 (Recall escolhe fontes conforme a intenção), AC-005 (Recall respeita orçamento e contrato de resposta), AC-006 (Recall degrada sem esconder indisponibilidade)
  arquivos permitidos (e seus testes): src/orchestration/intent.ts, src/orchestration/router.ts, src/orchestration/ranking.ts, src/orchestration/context-builder.ts, src/tools/brain-recall.ts, src/tools/brain-status.ts, tests/integration/recall-status.test.ts
  mensagem de commit: "T-009 mega-brain-mcp-v1: Implementar router, ranking, context builder, recall e status"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/vitest-results.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'gpt-5.6-sol' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-009 mega-brain-mcp-v1: Implementar router, ranking, context builder, recall e status (auto-commit do plano)'
    fi
    marcar_concluidas T-009
    verde "✔ T-009 concluída"
    return 0
  fi
  vermelho "✘ T-009 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --seq T-009"
  FALHAS="$FALHAS T-009"
  return 1
}

# ── sequencial T-010 (ordem do tasks.md) ──
executar_seq_T_010() {
  info 'sequencial T-010 — Implementar aprendizado e validação'
  if rodar_tarefa seq 'T-010' 'Você executa UMA tarefa da feature "mega-brain-mcp-v1" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/mega-brain-mcp-v1/spec.md, .spec/features/mega-brain-mcp-v1/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-010 — "Implementar aprendizado e validação"
  critérios/refs: AC-007 (Evidência define autoridade e confiança), AC-008 (Duplicatas e contradições evoluem sem apagar história), AC-009 (Conteúdo sensível não alcança a memória), AC-015 (Validação atualiza estado, não conteúdo)
  arquivos permitidos (e seus testes): src/learning/taxonomy.ts, src/learning/promotion.ts, src/learning/deduplication.ts, src/tools/brain-learn.ts, src/tools/brain-validate.ts, tests/integration/learn-validate.test.ts
  mensagem de commit: "T-010 mega-brain-mcp-v1: Implementar aprendizado e validação"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/vitest-results.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'gpt-5.6-sol' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-010 mega-brain-mcp-v1: Implementar aprendizado e validação (auto-commit do plano)'
    fi
    marcar_concluidas T-010
    verde "✔ T-010 concluída"
    return 0
  fi
  vermelho "✘ T-010 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --seq T-010"
  FALHAS="$FALHAS T-010"
  return 1
}

# ── sequencial T-011 (ordem do tasks.md) ──
executar_seq_T_011() {
  info 'sequencial T-011 — Implementar contexto de mudança e histórico'
  if rodar_tarefa seq 'T-011' 'Você executa UMA tarefa da feature "mega-brain-mcp-v1" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/mega-brain-mcp-v1/spec.md, .spec/features/mega-brain-mcp-v1/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-011 — "Implementar contexto de mudança e histórico"
  critérios/refs: AC-013 (Contexto de mudança reúne impacto e experiência), AC-014 (Histórico combina memória e Git sem reescrever o passado)
  arquivos permitidos (e seus testes): src/orchestration/change-context.ts, src/orchestration/history.ts, src/tools/brain-change-context.ts, src/tools/brain-history.ts, tests/integration/change-history.test.ts
  mensagem de commit: "T-011 mega-brain-mcp-v1: Implementar contexto de mudança e histórico"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/vitest-results.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'gpt-5.6-sol' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-011 mega-brain-mcp-v1: Implementar contexto de mudança e histórico (auto-commit do plano)'
    fi
    marcar_concluidas T-011
    verde "✔ T-011 concluída"
    return 0
  fi
  vermelho "✘ T-011 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --seq T-011"
  FALHAS="$FALHAS T-011"
  return 1
}

# ── sequencial T-012 (ordem do tasks.md) ──
executar_seq_T_012() {
  info 'sequencial T-012 — Implementar dispatcher de hooks de Codex e Claude Code'
  if rodar_tarefa seq 'T-012' 'Você executa UMA tarefa da feature "mega-brain-mcp-v1" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/mega-brain-mcp-v1/spec.md, .spec/features/mega-brain-mcp-v1/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-012 — "Implementar dispatcher de hooks de Codex e Claude Code"
  critérios/refs: AC-018 (Instalação e remoção preservam hooks existentes), AC-019 (Falha de hook não bloqueia o trabalho)
  arquivos permitidos (e seus testes): src/hooks/events.ts, src/hooks/dispatcher.ts, src/hooks/queue.ts, src/hooks/hosts/codex.ts, src/hooks/hosts/claude.ts, tests/integration/host-hooks.test.ts
  mensagem de commit: "T-012 mega-brain-mcp-v1: Implementar dispatcher de hooks de Codex e Claude Code"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/vitest-results.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'gpt-5.6-sol' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-012 mega-brain-mcp-v1: Implementar dispatcher de hooks de Codex e Claude Code (auto-commit do plano)'
    fi
    marcar_concluidas T-012
    verde "✔ T-012 concluída"
    return 0
  fi
  vermelho "✘ T-012 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --seq T-012"
  FALHAS="$FALHAS T-012"
  return 1
}

# ── sequencial T-013 (ordem do tasks.md) ──
executar_seq_T_013() {
  info 'sequencial T-013 — Implementar redaction, política de egress e métricas locais'
  if rodar_tarefa seq 'T-013' 'Você executa UMA tarefa da feature "mega-brain-mcp-v1" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/mega-brain-mcp-v1/spec.md, .spec/features/mega-brain-mcp-v1/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-013 — "Implementar redaction, política de egress e métricas locais"
  critérios/refs: AC-021 (Cloud e tools mutantes permanecem desabilitados por padrão)
  arquivos permitidos (e seus testes): src/security/redaction.ts, src/security/secret-patterns.ts, src/security/egress-policy.ts, src/observability/metrics.ts, src/observability/logger.ts, tests/security/redaction.test.ts, tests/security/egress.test.ts
  mensagem de commit: "T-013 mega-brain-mcp-v1: Implementar redaction, política de egress e métricas locais"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/vitest-results.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'gpt-5.6-sol' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-013 mega-brain-mcp-v1: Implementar redaction, política de egress e métricas locais (auto-commit do plano)'
    fi
    marcar_concluidas T-013
    verde "✔ T-013 concluída"
    return 0
  fi
  vermelho "✘ T-013 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --seq T-013"
  FALHAS="$FALHAS T-013"
  return 1
}

# ── sequencial T-014 (ordem do tasks.md) ──
executar_seq_T_014() {
  info 'sequencial T-014 — Implementar multiplexer Git e invalidação incremental'
  if rodar_tarefa seq 'T-014' 'Você executa UMA tarefa da feature "mega-brain-mcp-v1" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/mega-brain-mcp-v1/spec.md, .spec/features/mega-brain-mcp-v1/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-014 — "Implementar multiplexer Git e invalidação incremental"
  critérios/refs: AC-017 (Eventos são normalizados e idempotentes)
  arquivos permitidos (e seus testes): src/hooks/git/multiplexer.ts, src/hooks/git/install.ts, src/lifecycle/commit-handler.ts, src/lifecycle/revalidation.ts, tests/integration/git-hooks.test.ts
  mensagem de commit: "T-014 mega-brain-mcp-v1: Implementar multiplexer Git e invalidação incremental"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/vitest-results.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'gpt-5.6-sol' xhigh >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-014 mega-brain-mcp-v1: Implementar multiplexer Git e invalidação incremental (auto-commit do plano)'
    fi
    marcar_concluidas T-014
    verde "✔ T-014 concluída"
    return 0
  fi
  vermelho "✘ T-014 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --seq T-014"
  FALHAS="$FALHAS T-014"
  return 1
}

# ── sequencial T-015 (ordem do tasks.md) ──
executar_seq_T_015() {
  info 'sequencial T-015 — Implementar doctor, upgrade e uninstall reversíveis'
  if rodar_tarefa seq 'T-015' 'Você executa UMA tarefa da feature "mega-brain-mcp-v1" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/mega-brain-mcp-v1/spec.md, .spec/features/mega-brain-mcp-v1/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-015 — "Implementar doctor, upgrade e uninstall reversíveis"
  critérios/refs: AC-016 (Status mostra saúde sem expor secrets), AC-022 (Doctor comprova o ciclo real dos backends), AC-023 (Upgrade e uninstall são reversíveis)
  arquivos permitidos (e seus testes): src/cli/doctor.ts, src/cli/upgrade.ts, src/cli/uninstall.ts, src/runtime/transaction.ts, tests/e2e/lifecycle.test.ts
  mensagem de commit: "T-015 mega-brain-mcp-v1: Implementar doctor, upgrade e uninstall reversíveis"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/vitest-results.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'gpt-5.6-sol' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-015 mega-brain-mcp-v1: Implementar doctor, upgrade e uninstall reversíveis (auto-commit do plano)'
    fi
    marcar_concluidas T-015
    verde "✔ T-015 concluída"
    return 0
  fi
  vermelho "✘ T-015 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --seq T-015"
  FALHAS="$FALHAS T-015"
  return 1
}

# ── sequencial T-016 (ordem do tasks.md) ──
executar_seq_T_016() {
  info 'sequencial T-016 — Criar benchmark, CI, documentação e pacote de release'
  if rodar_tarefa seq 'T-016' 'Você executa UMA tarefa da feature "mega-brain-mcp-v1" (fluxo onp-spec, spec-anchored).
Leia primeiro: .spec/features/mega-brain-mcp-v1/spec.md, .spec/features/mega-brain-mcp-v1/tasks.md e .spec/constituicao.md.

Sua tarefa (somente ela):
T-016 — "Criar benchmark, CI, documentação e pacote de release"
  critérios/refs: AC-024 (Benchmark comprova economia sem reduzir qualidade), AC-025 (Release exige matriz suportada e audit limpo)
  arquivos permitidos (e seus testes): benchmark/questions.json, benchmark/runner.ts, tests/e2e/benchmark.test.ts, .github/workflows/ci.yml, .github/workflows/release.yml, README.md, docs/configuration.md, docs/security.md, docs/troubleshooting.md, LICENSE
  mensagem de commit: "T-016 mega-brain-mcp-v1: Criar benchmark, CI, documentação e pacote de release"

Regras inegociáveis:
- Todo critério de aceite referenciado vira teste com @spec:AC-xxx no título.
- NUNCA enfraqueça, pule (skip/todo) ou apague um teste para passar — teste pulado não é prova e o audit acusa.
- Rode os testes localmente com `npx vitest run --reporter=json --outputFile=.spec/verification/vitest-results.json` até passarem.
- NÃO edite tasks.md, NÃO rode onp-spec verify/audit e NÃO toque em outras tarefas — o orquestrador cuida disso.
- Ao final de CADA tarefa: `git add` só no que você tocou e um commit próprio.' 'gpt-5.6-terra' high >> "$LOG_DIR/seq.log" 2>&1; then
    # commit de segurança se o agente esqueceu (rastreabilidade > perfeição)
    if [ -n "$(git status --porcelain)" ]; then
      git add -A && git commit -q -m 'T-016 mega-brain-mcp-v1: Criar benchmark, CI, documentação e pacote de release (auto-commit do plano)'
    fi
    marcar_concluidas T-016
    verde "✔ T-016 concluída"
    return 0
  fi
  vermelho "✘ T-016 falhou (log: $LOG_DIR/seq.log)"
  amarelo "  reexecute só ela: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --seq T-016"
  FALHAS="$FALHAS T-016"
  return 1
}

# ── gate: quem decide é a máquina ────────────────────────────────────
rodar_gate() {
  echo
  info "gate: verify + audit --ci"
  evento --tipo gate --etapa inicio
  node "$ENGINE" verify "$FEATURE"
  local v=$?
  evento --tipo gate --etapa verify --exit "$v"
  node "$ENGINE" audit --ci
  AUDIT=$?
  evento --tipo gate --etapa audit --exit "$AUDIT"
  # fecha a contabilidade: status das tarefas + prova do verify no git
  if [ -n "$(git status --porcelain -- '.spec')" ]; then
    git add -A -- '.spec'
    git commit -q -m "$FEATURE: status das tarefas + prova do verify (plano)"
    info "status das tarefas e prova do verify commitados"
  fi
  return "$AUDIT"
}

encerrar() { # $1=escopo
  echo
  if [ -n "$FALHAS" ]; then vermelho "faixas/tarefas com falha:$FALHAS"; fi
  # sem gate não existe veredito: NUNCA anunciar alinhamento sem o audit
  if [ "$COM_GATE" -eq 0 ]; then
    evento --tipo fim --exit 1 --escopo "$1"
    if [ -z "$FALHAS" ]; then
      amarelo "○ trabalho de '$1' terminou SEM o gate (--sem-gate) — isto NÃO é prova de nada"
      amarelo "  para o veredito: bash .spec/features/mega-brain-mcp-v1/executar-tarefas.sh --gate"
      exit 0
    fi
    vermelho "e ainda há falhas — conserte e rode o gate"
    exit 1
  fi
  rodar_gate
  local audit=$?
  if [ "$audit" -eq 0 ] && [ -z "$FALHAS" ]; then
    evento --tipo fim --exit 0 --escopo "$1"
    verde "✔ plano concluído — especificação e código alinhados (audit exit 0) na branch $BASE_BRANCH"
    info "próximo passo: revise e leve para a main quando quiser (git merge $BASE_BRANCH)"
    exit 0
  fi
  evento --tipo fim --exit 1 --escopo "$1"
  vermelho "plano terminou com pendências — leia a saída do audit acima e os logs em $LOG_DIR"
  amarelo "dica: reexecute só o que falhou (--faixa <id> / --seq <T-xxx>)"
  exit 1
}

executar_tudo() {
  evento --tipo inicio --escopo tudo
  iniciar_resumos
  info "logs em: $LOG_DIR"
  info "resumo geral de andamento: a cada 1 min aqui no terminal (e via: onp-spec resumo)"
  executar_seq_T_003 || true
  executar_seq_T_004 || true
  executar_seq_T_005 || true
  executar_seq_T_006 || true
  executar_seq_T_007 || true
  executar_seq_T_008 || true
  executar_seq_T_009 || true
  executar_seq_T_010 || true
  executar_seq_T_011 || true
  executar_seq_T_012 || true
  executar_seq_T_013 || true
  executar_seq_T_014 || true
  executar_seq_T_015 || true
  executar_seq_T_016 || true
  encerrar tudo
}

listar() {
  echo "execução: $RUN_ID (feature $FEATURE, branch $BASE_BRANCH)"
  echo "  seq       T-003 (sequencial)"
  echo "  seq       T-004 (sequencial)"
  echo "  seq       T-005 (sequencial)"
  echo "  seq       T-006 (sequencial)"
  echo "  seq       T-007 (sequencial)"
  echo "  seq       T-008 (sequencial)"
  echo "  seq       T-009 (sequencial)"
  echo "  seq       T-010 (sequencial)"
  echo "  seq       T-011 (sequencial)"
  echo "  seq       T-012 (sequencial)"
  echo "  seq       T-013 (sequencial)"
  echo "  seq       T-014 (sequencial)"
  echo "  seq       T-015 (sequencial)"
  echo "  seq       T-016 (sequencial)"
  echo
  echo "reexecutar uma faixa:    --faixa <id>"
  echo "reexecutar sequencial:   --seq <T-xxx>"
  echo "só o gate:               --gate"
}

MODO="tudo"
ALVO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --listar) MODO="listar" ;;
    --gate) MODO="gate" ;;
    --sem-gate) COM_GATE=0 ;;
    --faixa) MODO="faixa"; ALVO="${2:-}"; shift ;;
    --seq) MODO="seq"; ALVO="${2:-}"; shift ;;
    -h|--help) sed -n "2,14p" "$0"; exit 0 ;;
    *) vermelho "argumento desconhecido: $1"; sed -n "2,14p" "$0"; exit 2 ;;
  esac
  shift
done

if [ "$MODO" = "listar" ]; then listar; exit 0; fi

preparar_ambiente

case "$MODO" in
  tudo) executar_tudo ;;
  gate) COM_GATE=1; iniciar_resumos; encerrar gate ;;
  faixa)
    case "$ALVO" in
      *) falhar "faixa desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;
    esac ;;
  seq)
    case "$ALVO" in
      T-003) evento --tipo inicio --escopo "seq:T-003"; iniciar_resumos; executar_seq_T_003 || true; encerrar "seq:T-003" ;;
      T-004) evento --tipo inicio --escopo "seq:T-004"; iniciar_resumos; executar_seq_T_004 || true; encerrar "seq:T-004" ;;
      T-005) evento --tipo inicio --escopo "seq:T-005"; iniciar_resumos; executar_seq_T_005 || true; encerrar "seq:T-005" ;;
      T-006) evento --tipo inicio --escopo "seq:T-006"; iniciar_resumos; executar_seq_T_006 || true; encerrar "seq:T-006" ;;
      T-007) evento --tipo inicio --escopo "seq:T-007"; iniciar_resumos; executar_seq_T_007 || true; encerrar "seq:T-007" ;;
      T-008) evento --tipo inicio --escopo "seq:T-008"; iniciar_resumos; executar_seq_T_008 || true; encerrar "seq:T-008" ;;
      T-009) evento --tipo inicio --escopo "seq:T-009"; iniciar_resumos; executar_seq_T_009 || true; encerrar "seq:T-009" ;;
      T-010) evento --tipo inicio --escopo "seq:T-010"; iniciar_resumos; executar_seq_T_010 || true; encerrar "seq:T-010" ;;
      T-011) evento --tipo inicio --escopo "seq:T-011"; iniciar_resumos; executar_seq_T_011 || true; encerrar "seq:T-011" ;;
      T-012) evento --tipo inicio --escopo "seq:T-012"; iniciar_resumos; executar_seq_T_012 || true; encerrar "seq:T-012" ;;
      T-013) evento --tipo inicio --escopo "seq:T-013"; iniciar_resumos; executar_seq_T_013 || true; encerrar "seq:T-013" ;;
      T-014) evento --tipo inicio --escopo "seq:T-014"; iniciar_resumos; executar_seq_T_014 || true; encerrar "seq:T-014" ;;
      T-015) evento --tipo inicio --escopo "seq:T-015"; iniciar_resumos; executar_seq_T_015 || true; encerrar "seq:T-015" ;;
      T-016) evento --tipo inicio --escopo "seq:T-016"; iniciar_resumos; executar_seq_T_016 || true; encerrar "seq:T-016" ;;
      *) falhar "tarefa sequencial desconhecida: '$ALVO' — veja as disponíveis com --listar" ;;
    esac ;;
esac
