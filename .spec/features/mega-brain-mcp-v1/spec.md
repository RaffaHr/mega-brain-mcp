# Spec: Mega Brain MCP v1

> feature: mega-brain-mcp-v1
> status: pronta

## Contexto

Agentes de programação gastam contexto redescobrindo a arquitetura, decisões e
falhas de um projeto, enquanto memórias antigas podem permanecer convincentes
depois que o código mudou. O Mega Brain MCP deve oferecer um único ponto de
acesso instalável que orquestre AgentMemory, Code Review Graph e Git, entregue
contexto mínimo com provenance e evolua conhecimento sem confundir observação
com verdade atual.

## Histórias

### US-001 — Instalação gerenciada e reproduzível

Como mantenedor, quero instalar o Mega Brain e seus backends por um único fluxo,
para que cada projeto use versões compatíveis sem configuração manual frágil.

#### AC-001 — Instalação cria runtime isolado e verificável

- **Dado** um ambiente limpo com Node 20+ e Python 3.10+
- **Quando** o mantenedor executa `mega-brain install` para um repositório
- **Então** o runtime gerenciado é criado com versões travadas e o diagnóstico confirma os dois backends

#### AC-002 — O host enxerga somente o Mega Brain

- **Dado** uma instalação concluída para Codex ou Claude Code
- **Quando** o host lista seus servidores e ferramentas MCP
- **Então** encontra somente o servidor Mega Brain com exatamente as seis tools públicas

#### AC-003 — Configuração dos backends é encaminhada com segurança

- **Dado** configurações válidas ou perigosas nos mapas de ambiente dos backends
- **Quando** o Mega Brain prepara os processos filhos
- **Então** encaminha as chaves permitidas, redige secrets e recusa variáveis capazes de alterar a execução

### US-002 — Recuperação de contexto mínimo e atual

Como agente de programação, quero perguntar como o projeto funciona e receber
somente o contexto necessário, para economizar tokens sem confiar em informação
obsoleta.

#### AC-004 — Recall escolhe fontes conforme a intenção

- **Dado** perguntas de implementação, impacto, arquitetura, decisão e histórico
- **Quando** `brain_recall` classifica cada pergunta
- **Então** consulta Git, CRG e AgentMemory na ordem definida para cada intenção

#### AC-005 — Recall respeita orçamento e contrato de resposta

- **Dado** um projeto com memória e grafo disponíveis
- **Quando** `brain_recall` recebe depth ou tokenBudget
- **Então** retorna o envelope versionado e um context pack dentro do limite configurado

#### AC-006 — Recall degrada sem esconder indisponibilidade

- **Dado** um dos backends indisponível
- **Quando** as fontes restantes ainda conseguem responder parcialmente
- **Então** retorna `degraded` com avisos e provenance das fontes realmente usadas

### US-003 — Aprendizado explícito com evidência

Como agente de programação, quero registrar descobertas, decisões e lições com
provenance, para que conhecimento futuro tenha autoridade mensurável.

#### AC-007 — Evidência define autoridade e confiança

- **Dado** aprendizado com evidência válida ou sem evidência verificável
- **Quando** `brain_learn` processa o conteúdo
- **Então** grava conhecimento verificado no primeiro caso e limita o segundo a experiential/unverified

#### AC-008 — Duplicatas e contradições evoluem sem apagar história

- **Dado** uma memória equivalente, reforçada ou incompatível com conhecimento existente
- **Quando** `brain_learn` tenta persistir a nova afirmação
- **Então** deduplica ou reforça equivalentes e registra conflito/supersession para afirmações incompatíveis

#### AC-009 — Conteúdo sensível não alcança a memória

- **Dado** conteúdo contendo secrets reconhecíveis
- **Quando** `brain_learn` ou um hook prepara uma observação
- **Então** o valor sensível é redigido antes de qualquer chamada ao AgentMemory

### US-004 — Freshness dirigida por Git e grafo

Como agente de programação, quero saber se uma memória continua verdadeira no
checkout atual, para não aplicar decisões antigas ao código novo.

#### AC-010 — Mudança não relacionada preserva memória válida

- **Dado** uma memória cujas evidências mantêm os mesmos hashes
- **Quando** o HEAD avança por mudanças não relacionadas
- **Então** a memória permanece `FRESH` sem releitura ampla do código

#### AC-011 — Mudança direta, indireta ou não commitada invalida confiança

- **Dado** alteração em evidência, símbolo relacionado pelo blast radius ou working tree relevante
- **Quando** freshness é recalculado
- **Então** a memória deixa de ser `FRESH` e recebe o estado e motivo adequados

#### AC-012 — Remoção, contradição e substituição têm estados distintos

- **Dado** evidência removida, afirmações atuais incompatíveis ou substituição explícita
- **Quando** a validação termina
- **Então** retorna respectivamente `STALE`, `CONFLICT` ou `DEPRECATED`

### US-005 — Contexto de mudança e histórico temporal

Como agente de programação, quero entender o impacto de uma mudança e as razões
históricas relacionadas, para alterar código com menos regressões.

#### AC-013 — Contexto de mudança reúne impacto e experiência

- **Dado** um símbolo ou arquivo registrado no projeto
- **Quando** `brain_change_context` é chamado
- **Então** retorna dependências, flows, testes, regras, bugs, decisões e riscos encontrados

#### AC-014 — Histórico combina memória e Git sem reescrever o passado

- **Dado** uma consulta temporal com intervalo opcional
- **Quando** `brain_history` é chamado
- **Então** retorna uma timeline ordenada de sessões, memórias e commits com a estrutura atual claramente separada

### US-006 — Validação e diagnóstico operacional

Como mantenedor, quero validar conhecimento e diagnosticar o runtime, para
detectar incompatibilidade, lag e configuração incorreta antes de confiar nele.

#### AC-015 — Validação atualiza estado, não conteúdo

- **Dado** ids de memória ou uma consulta válida
- **Quando** `brain_validate` compara provenance com Git e CRG
- **Então** persiste somente validação/freshness e exige `brain_learn` para substituir conteúdo

#### AC-016 — Status mostra saúde sem expor secrets

- **Dado** backends saudáveis, degradados ou com graph SHA divergente do HEAD
- **Quando** `brain_status` ou `mega-brain doctor` executa
- **Então** informa versões, capabilities, hooks, fila, lag e divergências com configuração redigida

### US-007 — Hooks unificados e seguros

Como mantenedor, quero que Codex, Claude Code e Git alimentem o cérebro sem
duplicação nem perda das integrações existentes.

#### AC-017 — Eventos são normalizados e idempotentes

- **Dado** eventos equivalentes ou repetidos de host e Git
- **Quando** o dispatcher os recebe
- **Então** captura observações, agenda updates e invalidações uma única vez por idempotency key

#### AC-018 — Instalação e remoção preservam hooks existentes

- **Dado** configurações de hooks próprias ou de terceiros
- **Quando** Mega Brain instala, atualiza ou remove seu dispatcher
- **Então** preserva as entradas anteriores e restaura o estado original no uninstall

#### AC-019 — Falha de hook não bloqueia o trabalho

- **Dado** backend indisponível durante um hook
- **Quando** o evento é processado
- **Então** o host/Git continua, o evento recuperável entra na fila e o status revela o backlog

### US-008 — Acesso local com privilégio mínimo

Como responsável pelo código, quero controlar o que o Mega Brain pode ler ou
enviar, para adotar o produto sem ampliar a superfície de exposição.

#### AC-020 — Leitura direta permanece dentro do repositório autorizado

- **Dado** arquivo tracked válido, arquivo ignorado ou tentativa de escape por path/symlink
- **Quando** o fallback de leitura é acionado
- **Então** somente o arquivo tracked dentro do root real pode ser lido sob limites de bytes e linhas

#### AC-021 — Cloud e tools mutantes permanecem desabilitados por padrão

- **Dado** uma instalação sem opt-in de egress
- **Quando** o sistema inicializa e negocia capabilities
- **Então** não envia dados para cloud e não disponibiliza tools mutantes dos backends

### US-009 — Operação reversível e atualizável

Como mantenedor, quero atualizar ou remover o produto com segurança, para não
ficar preso a estado corrompido ou configuração residual.

#### AC-022 — Doctor comprova o ciclo real dos backends

- **Dado** runtime instalado
- **Quando** `mega-brain doctor` executa
- **Então** realiza REST health/auth, handshake MCP real, valida schemas necessários e compara graph SHA com HEAD

#### AC-023 — Upgrade e uninstall são reversíveis

- **Dado** uma instalação existente com dados e hooks anteriores
- **Quando** upgrade falha ou uninstall padrão é solicitado
- **Então** restaura runtime/config anterior e preserva dados até purge explícito

### US-010 — Qualidade demonstrável

Como mantenedor do projeto open-source, quero gates e benchmarks reproduzíveis,
para publicar uma v1 que prove correção, economia e compatibilidade.

#### AC-024 — Benchmark comprova economia sem reduzir qualidade

- **Dado** um corpus de 50 a 100 perguntas e uma suíte de mutações
- **Quando** a avaliação compara baseline e Mega Brain
- **Então** mantém qualidade, não produz resposta incorreta marcada `FRESH`, reduz contexto em pelo menos 60% e limita raw-code fallback a 25% das perguntas cobertas

#### AC-025 — Release exige matriz suportada e audit limpo

- **Dado** uma candidata a release v1
- **Quando** a CI executa unitários, contratos, integração, segurança e E2E suportados
- **Então** a publicação só prossegue com Codex e Claude comprovados em Windows e Ubuntu/WSL e `onp-spec audit --ci` com exit code 0

## Fora de escopo

- Migração ou sincronização de Obsidian no v1.
- Hosts além de Codex e Claude Code como plataformas oficialmente testadas.
- Interface gráfica, serviço SaaS ou sincronização remota multiusuário.
- Egress, embeddings cloud ou LLM obrigatório por padrão.
- Armazenar AST ou código-fonte integral dentro do AgentMemory.
- Expor refactor, escrita de código ou outras tools mutantes dos backends.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-001 | O control plane será TypeScript/Node e usará mcp-use. | confirmada | Escolha aprovada no planejamento em 24/08/2026. |
| ASM-002 | AgentMemory será global por usuário; CRG e metadata serão isolados por checkout/worktree. | confirmada | Escolha aprovada no planejamento em 24/08/2026. |
| ASM-003 | O instalador gerenciará dependências, mas Node 20+ e Python 3.10+ serão pré-requisitos. | confirmada | Modelo gerenciado híbrido aprovado. |
| ASM-004 | A v1 suportará Codex e Claude Code e será publicada sob Apache-2.0. | confirmada | Escopo e distribuição aprovados. |
| ASM-005 | Recursos locais são padrão e qualquer egress/LLM é opt-in. | confirmada | Política de privacidade e custo aprovada. |

## Perguntas em aberto

Nenhuma. As decisões de produto necessárias para a v1 foram respondidas no
planejamento aprovado em 24/08/2026.
