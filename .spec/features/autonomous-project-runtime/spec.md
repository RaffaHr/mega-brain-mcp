# Spec: Runtime autônomo e isolado por projeto

> feature: autonomous-project-runtime
> status: pronta

## Contexto

O Mega Brain já instala runtimes e configura Codex ou Claude Code, mas o fluxo principal ainda registra um endpoint HTTP que exige `start` e `serve` manuais. Além disso, a porta fixa do AgentMemory permite conexão cruzada entre projetos, o rollback não recompõe o runtime em toda falha, caminhos de dados relativos e `MEGA_BRAIN_PORT` não obedecem integralmente à configuração do projeto, e a matriz isolada não executa o cenário Node 24.19 prometido.

Esta feature torna a experiência autônoma: abrir o projeto no agente de código inicia um MCP `stdio` do Mega Brain, que adquire o supervisor daquele projeto, inicia os backends privados, mantém leases para sessões concorrentes e encerra o runtime depois da última desconexão. Um novo `mega-brain setup` guia toda a configuração interativa, enquanto `mega-brain install` permanece determinístico para CI e automação.

## Histórias

### US-017 — Usar o Mega Brain sem iniciar serviços manualmente

Como usuário de Codex ou Claude Code, quero que o Mega Brain seja iniciado ao abrir o projeto, para usar suas tools sem executar `start` ou `serve`.

#### AC-039 — Host inicia o MCP stdio automaticamente

- **Dado** um projeto configurado para Codex, Claude Code ou ambos
- **Quando** o host abre a configuração MCP do projeto
- **Então** executa `mega-brain mcp` por `stdio`, recebe `initialize` e `tools/list` com as seis tools `brain_*` e não depende de endpoint HTTP iniciado manualmente

#### AC-040 — MCP sobe e aguarda backends privados

- **Dado** nenhum processo Mega Brain, AgentMemory ou Code Review Graph ativo para o projeto
- **Quando** o primeiro cliente MCP conecta por `stdio`
- **Então** inicia o supervisor exclusivo já definido para o projeto como processo independente, publica somente PID, protocolo, IPC e `worktreeId` em manifest protegido, espera readiness dos backends exigidos pelo modo antes de aceitar chamadas e mantém os MCPs internos invisíveis ao host

#### AC-041 — Sessões do mesmo projeto compartilham leases

- **Dado** duas ou mais sessões Codex ou Claude Code abertas no mesmo worktree
- **Quando** elas conectam e desconectam em ordens diferentes
- **Então** reutilizam um único supervisor do projeto, renovam leases a cada 10 segundos com expiração em 30 segundos, nenhuma sessão encerra backends ainda utilizados e o runtime inicia shutdown 5 segundos após a última lease expirar ou desconectar

### US-018 — Configurar o produto por um assistente completo

Como usuário instalando o Mega Brain, quero responder a um setup interativo, para configurar o projeto e os backends sem editar arquivos manualmente.

#### AC-042 — Setup descobre projeto e valida pré-requisitos

- **Dado** um terminal interativo dentro ou fora de um repositório Git
- **Quando** `mega-brain setup` é executado e o usuário aceita o diretório atual ou informa outro caminho
- **Então** resolve a raiz real, apresenta Node, Python, Git e compatibilidade da plataforma encontrados, não cria arquivos nem baixa pacotes se o preflight falhar ou o usuário cancelar e mantém o wizard no passo inválido para nova tentativa ou troca de modo

#### AC-043 — Setup oferece configuração completa com defaults seguros

- **Dado** um ambiente compatível
- **Quando** o usuário percorre o assistente
- **Então** pode escolher Codex, Claude Code ou ambos, AgentMemory gerenciado ou remoto, informar URL remota e referência da variável de secret quando aplicável, escolher defaults ou opções avançadas do AgentMemory e Code Review Graph, localização dos dados e opt-ins de egress/LLM, recebendo ao final um resumo redigido antes de confirmar

#### AC-044 — Caminho feliz exige apenas escolhas essenciais

- **Dado** um usuário que aceita todos os defaults
- **Quando** conclui `mega-brain setup`
- **Então** obtém runtime gerenciado local, incluindo iii-engine fixado e validado no runtime isolado quando a plataforma exigir, isolamento estrito, ambos os backends configurados, host escolhido pronto para iniciar por `stdio` e instrução final para reabrir a sessão

#### AC-045 — Instalação não interativa continua determinística

- **Dado** CI, script ou terminal sem TTY com todas as opções obrigatórias
- **Quando** `mega-brain install` é executado
- **Então** não solicita entrada, produz o mesmo estado validado pelo setup e, para qualquer opção ausente ou incompatível, retorna erro acionável com código diferente de zero sem alterar arquivos, baixar pacotes ou manter processos

#### AC-057 — Diretórios sem Git não bloqueiam inicialização

- **Dado** um diretório de projeto que ainda não possui `.git`
- **Quando** setup, install, mcp, serve ou status resolvem o contexto do projeto
- **Então** o Mega Brain deriva uma identidade estável do caminho real, registra que Git está indisponível e só degrada ou falha nas operações que dependem de Git, como hooks, evidência de commit ou histórico

#### AC-058 — MCP stdio nunca fica silencioso antes de aceitar mensagens

- **Dado** `mega-brain mcp --repo .` em um projeto sem runtime instalado ou com runtime inválido
- **Quando** o comando é iniciado manualmente ou por host MCP
- **Então** emite logs informativos em `stderr`, verifica o runtime antes de iniciar supervisor e falha rápido com erro acionável em vez de ficar aguardando sem saída visível

#### AC-059 — Ciclo de instalação reporta progresso

- **Dado** setup, install, doctor, upgrade ou uninstall executando etapas longas ou transacionais
- **Quando** cada etapa relevante começa ou termina
- **Então** o comando emite logs informativos redigidos e redigidos contra segredo no canal apropriado, sem poluir `stdout` de JSON ou MCP stdio

#### AC-060 — Runtime existente sem estado ativo é drenado antes do swap

- **Dado** um projeto com `runtime/current` já criado no Windows, mesmo sem `runtime-state.json`
- **Quando** `mega-brain install` ou `mega-brain upgrade` substitui o runtime
- **Então** drena supervisor e backends existentes antes de renomear `runtime/current`, mas só reinicia automaticamente quando o runtime estava registrado como ativo

#### AC-061 — Multi-host e uninstall toleram variações do Windows

- **Dado** install ou uninstall recebendo `--hosts codex,claude`, `--hosts codex claude`, flags repetidas ou `--hosts both`
- **Quando** o CLI interpreta a lista de hosts
- **Então** configura ou restaura Codex e Claude sem rejeitar combinações válidas e sem duplicar hosts
- **E** o uninstall usa retry transacional ao mover `runtime/current` para quarentena quando o Windows retorna erros transitórios de handle aberto

### US-019 — Isolar completamente runtimes e dados por projeto

Como usuário com vários projetos ou worktrees, quero isolamento físico e lógico, para que memória, grafo, processos ou credenciais nunca atravessem projetos.

#### AC-046 — Layout é absoluto e derivado da identidade correta

- **Dado** projetos, clones e worktrees distintos, inclusive comando executado fora do caminho passado em `--repo`
- **Quando** configuração e runtime são resolvidos
- **Então** cada worktree recebe caminhos absolutos próprios sob seu namespace e todo caminho relativo é resolvido contra a raiz do repositório selecionado, nunca contra o diretório acidental do processo

#### AC-047 — AgentMemory e Code Review Graph usam armazenamento exclusivo

- **Dado** dois projetos gerenciados executados simultaneamente com observações e grafos sentinela diferentes
- **Quando** cada projeto aprende, consulta, indexa e reinicia seus backends
- **Então** AgentMemory, iii-engine, Code Review Graph e provenance usam diretórios exclusivos, o AgentMemory recebe seu conjunto próprio de portas REST, streams, viewer e engine e nenhuma resposta ou arquivo contém o sentinela do outro projeto

#### AC-048 — Endpoints e controle de runtime não colidem

- **Dado** dois projetos ativos ao mesmo tempo e múltiplos clientes em cada um
- **Quando** os supervisores alocam IPC, portas loopback, locks e credenciais efêmeras
- **Então** cada recurso pertence a um único `worktreeId`, named pipe com ACL do usuário no Windows ou socket `0600` no Unix restringe o IPC, a conexão valida protocolo, PID e identidade e readiness de um projeto nunca pode satisfazer outro

#### AC-049 — Backend remoto respeita isolamento estrito

- **Dado** AgentMemory remoto selecionado com isolamento estrito habilitado por padrão
- **Quando** o setup ou install negocia capabilities
- **Então** usa o secret apenas em memória para gravar um sentinela descartável no namespace A, prova presença em A e ausência em B, confirma o cleanup e recusa configuração remota sem essa garantia; no setup a etapa pode ser repetida ou trocada para gerenciado, enquanto install encerra sem mutações

### US-020 — Fazer configuração persistida corresponder ao comportamento

Como mantenedor, quero uma única resolução de configuração por projeto, para que CLI, supervisor, backends e documentação usem exatamente os valores escolhidos.

#### AC-050 — Configuração tem origem e precedência observáveis

- **Dado** configuração local do projeto, `.env`, arquivo indicado por `--config`, variáveis do processo e flags CLI
- **Quando** setup, install, mcp, serve ou doctor resolve a configuração
- **Então** todos usam o mesmo resolver, mostram a origem efetiva sem revelar segredos e aplicam a precedência documentada de flags, processo, `.env`, arquivo e defaults

#### AC-051 — Porta e diretório de dados são aplicados de verdade

- **Dado** `MEGA_BRAIN_PORT` no `.env` para o modo HTTP explícito e `MEGA_BRAIN_DATA_DIR` relativo ou absoluto
- **Quando** install, serve e doctor são executados a partir de outro diretório
- **Então** usam a porta configurada e resolvem o diretório relativo contra o projeto selecionado, com os mesmos valores em host integration, runtime e diagnóstico

#### AC-052 — Diretório do CRG chega ao processo instalado

- **Dado** um Code Review Graph gerenciado ou customizado
- **Quando** ele é instalado, indexado, iniciado e diagnosticado
- **Então** o adaptador encaminha `CRG_DATA_DIR` e `CRG_REPO_ROOT` absolutos durante build e serve, prova onde o grafo foi persistido e a instalação falha antes do commit se essa prova não for possível

#### AC-053 — Segredos permanecem apenas em memória ou ambiente

- **Dado** token remoto, chave de embedding ou credencial de LLM necessária
- **Quando** o setup coleta ou valida a configuração
- **Então** não grava o valor em config, `.env`, manifest, logs ou resumo e persiste somente a referência ao nome da variável que deverá fornecê-lo

### US-021 — Fechar transações e matriz de compatibilidade

Como mantenedor, quero provas isoladas dos casos que falharam na revisão, para que instalação e rollback sejam confiáveis antes da publicação.

#### AC-054 — Falha restaura runtime e integrações juntos

- **Dado** runtime anterior válido e configurações de host ou hooks existentes
- **Quando** qualquer etapa após o staging falha, incluindo escrita de host, hook, lock ou readiness
- **Então** uma única transação restaura bytes, caminhos, runtime ativo, iii-engine, backends, manifest e integrações anteriores, remove staging e filhos novos e deixa o projeto utilizável

#### AC-055 — Matriz executa as duas versões Node suportadas

- **Dado** tarball produzido pelo pacote e contêineres Node 22.22/Python 3.10+ e Node 24.19/Python 3.11+
- **Quando** o harness isolado executa setup não interativo, carregamento MCP stdio, chamada real das tools e uninstall
- **Então** ambos concluem o ciclo sem montar `src`, `node_modules` ou runtime do checkout de desenvolvimento

#### AC-056 — Matriz concorrente prova isolamento e encerramento

- **Dado** dois repositórios descartáveis configurados a partir do mesmo tarball
- **Quando** clientes MCP simultâneos exercitam aprendizado, recall, grafo e fechamento em cada projeto
- **Então** os sentinelas permanecem separados, leases são contabilizadas, processos encerram após a última sessão e não restam portas, locks ou filhos órfãos

## Fora de escopo

- Suportar hosts além de Codex e Claude Code nesta feature.
- Tornar AgentMemory ou Code Review Graph MCPs públicos para o host.
- Remover `start`, `serve` e `stop`; permanecem como comandos avançados, de diagnóstico e compatibilidade, mas deixam de ser necessários no fluxo comum.
- Criar um serviço global compartilhado entre projetos.
- Habilitar egress, LLM ou armazenamento remoto por padrão.
- Publicar no npm ou criar tag de release durante esta feature.
- Implementar interface gráfica fora do terminal.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-011 | O transporte padrão do host deve ser MCP `stdio`, iniciado pela configuração do projeto. | confirmada | O usuário escolheu a opção 1 para eliminar `start` e `serve` manuais. |
| ASM-012 | O assistente interativo será `mega-brain setup`, mantendo `mega-brain install` não interativo. | confirmada | O usuário escolheu separar a UX humana da automação determinística. |
| ASM-013 | Sessões simultâneas do mesmo projeto devem compartilhar um supervisor com leases. | confirmada | O usuário escolheu um supervisor por projeto que encerra após a última sessão. |
| ASM-014 | Isolamento estrito será default e modos remotos compartilhados exigirão opt-out explícito. | confirmada | Derivado do requisito de isolamento total e dos princípios locais de privilégio mínimo e egress opt-in. |
| ASM-015 | O supervisor já planejado será descoberto por manifest sem segredo e protegido pelo controle de acesso do IPC do sistema operacional. | confirmada | O usuário confirmou manter o supervisor existente, remover o nonce efêmero e usar ACL do usuário no Windows ou socket `0600` no Unix. |
| ASM-016 | Leases usarão heartbeat de 10 segundos, expiração de 30 segundos e grace period de 5 segundos. | confirmada | O usuário aprovou tempos determinísticos e configuráveis, com relógio injetado nos testes. |
| ASM-017 | Isolamento remoto estrito será provado por sentinela reversível entre dois namespaces. | confirmada | O usuário confirmou retry ou troca de modo no setup; install não interativo falha sem mutações. |
| ASM-018 | No Windows gerenciado, o iii-engine fixado será instalado no runtime isolado; modo remoto não instala nem inicia AgentMemory ou iii-engine local. | confirmada | O usuário escolheu runtime gerenciado com checksum e confirmou a bifurcação remoto versus local. |

## Perguntas em aberto

Nenhuma.
