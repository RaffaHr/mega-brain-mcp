# Spec: Fase0 hardening

> feature: fase0-hardening
> status: pronta

## Contexto

Correções de integridade, segurança, concorrência e latência identificadas na auditoria do código real do Mega Brain MCP. Previne perda de dados concorrentes, vazamento de segredos em payloads brutos de hooks git e penalização inadequada de aprendizado.

## Histórias

### US-022 — Segurança e integridade de hooks e fila

Como sistema de memória e proveniência, quero que eventos de hook recebam redação antes da gravação e que a fila trate falhas sem perda ou bloqueio definitivo de eventos, para que segredos não persistam crus e execuções concorrentes não corrompam o estado.

#### AC-062 — Redação obrigatória em payloads de hooks git

- **Dado** uma execução de git hook com argumentos ou entrada padrão contendo segredos ou tokens
- **Quando** o hook for processado ou falhar em `handleGitHook`
- **Então** os dados persistidos no payload de erro ou gravados em fila devem ser sanitizados via `redactRecord`, sem expor chaves ou tokens crus em disco

#### AC-063 — Fila durável com isolamento concorrente e replay de falhas

- **Dado** múltiplos hooks concorrentes e eventos que falham durante a execução de ferramentas
- **Quando** a fila consultar eventos existentes via `has()` ou processar a fila
- **Então** eventos processados com sucesso permanecem concluídos, eventos falhos não são ignorados para sempre como duplicatas e gravações concorrentes não causam lost update

### US-023 — Concorrência de banco e integridade de evidências

Como motor de proveniência, quero deduplicação consistente de evidências sem símbolo e bloqueio adequado de concorrência no SQLite, para evitar crescimento descontrolado da tabela e erros de travamento sob processos paralelos.

#### AC-064 — Deduplicação de evidências com símbolo ausente via migration v2

- **Dado** referências de memória com o mesmo caminho, hash de blob e memória, porém sem símbolo específico
- **Quando** a proveniência persistir a evidência em `saveMemoryReference`
- **Então** o registro deve ser deduplicado na tabela `evidence` via migration v2, sem criar linhas duplicadas a cada salvamento

#### AC-065 — Configuração de busy_timeout em todos os backends SQLite

- **Dado** o banco SQLite sendo acessado por processos simultâneos via `better-sqlite3` ou `node:sqlite`
- **Quando** uma conexão for inicializada
- **Então** o `PRAGMA busy_timeout` deve ser executado para permitir espera estruturada em vez de falha imediata por lock

### US-024 — Qualidade de ranking e concorrência no recall

Como agente consumindo contexto, quero que memórias de regras, bugs e decisões não sejam descartadas por pontuações enviesadas e que as fontes sejam consultadas em paralelo, para obter contexto balanceado no menor tempo possível.

#### AC-066 — Eliminação do viés fixo contra AgentMemory em change-context

- **Dado** uma consulta de `change-context` com orçamento restrito
- **Quando** os chunks de código e memória forem classificados e empacotados
- **Então** memórias do AgentMemory não devem receber penalidade artificial fixa (0.8 vs 0.95), permitindo que regras e bugs compitam de forma justa com contexto estrutural

#### AC-067 — Consulta paralela a fontes com isolamento de falhas em brain-recall

- **Dado** uma chamada à tool `brain_recall` com múltiplas fontes configuradas
- **Quando** a recuperação for acionada
- **Então** as fontes disponíveis devem ser consultadas em paralelo via `Promise.all`, isolando exceções por fonte com warnings tipados sem interromper as demais

### US-025 — Observabilidade de recall e parsing seguro de git status

Como operador do sistema, quero visibilidade da latência e contagem de chunks em recall, além de suporte a renomeação de arquivos no status do Git, para diagnosticar gargalos e rastrear movimentação de código.

#### AC-068 — Instrumentação de métricas no caminho de recall

- **Dado** execuções de `brain_recall` e ranqueamento de chunks
- **Quando** a recuperação for concluída
- **Então** métricas de latência por fonte e descarte/inclusão de chunks devem ser registradas via `observability/metrics.ts`

#### AC-069 — Suporte a rename no parser de git status

- **Dado** arquivos renomeados no repositório no formato `R  origem -> destino` ou formato separado por NUL
- **Quando** `git.status()` for executado
- **Então** os arquivos renomeados devem ser mapeados corretamente sem truncamento ou falha de leitura de caminho

## Fora de escopo

- Expansão da allowlist do Code Review Graph
- Implementação de Graph of Graphs / Overlay Graph
- Consulta a novas rotas REST do AgentMemory além das existentes

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-019 | O SQLite padrão aceita PRAGMA busy_timeout tanto no driver nativo quanto no wrapper node:sqlite | confirmada | Validado nos testes dos dois backends |

## Perguntas em aberto

Nenhuma.
