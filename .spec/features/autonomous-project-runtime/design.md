# Design: Runtime autônomo e isolado por projeto

## Decisões confirmadas

1. O transporte padrão entre host e Mega Brain será MCP `stdio`.
2. `mega-brain setup` será a experiência interativa; `install` continuará não interativo e determinístico.
3. Haverá um supervisor por projeto com leases para clientes concorrentes.
4. Isolamento estrito será o default. Compartilhamento remoto exige decisão explícita e diagnosticável.
5. O supervisor existente será um processo independente descoberto por manifest sem segredo e protegido pelo IPC do sistema operacional.
6. AgentMemory remoto será aceito em modo estrito somente após probe reversível entre namespaces.
7. Windows gerenciado receberá iii-engine fixado e verificado dentro do runtime isolado; modo remoto não instala esse backend local.

## Arquitetura

```text
Codex/Claude --stdio--> mega-brain mcp (gateway por sessão)
                              |
                              | IPC privado + lease + worktreeId
                              v
                    supervisor único do projeto
                     /          |           \
            AgentMemory        CRG       provenance/Git
           data + endpoint   data + proc     por projeto
```

O arquivo MCP do projeto inicia `mega-brain mcp --repo <raiz>`. Esse processo mantém stdout reservado ao protocolo MCP, resolve a identidade do worktree e adquire uma lease no supervisor daquele namespace. A primeira conexão cria sob lock atômico o mesmo supervisor já planejado, executando `mega-brain supervisor --repo <raiz>` como processo independente; conexões seguintes validam identidade e se ligam ao IPC existente. O gateway só conclui `initialize` depois que os backends obrigatórios para o modo escolhido estão prontos.

`start`, `serve` e `stop` permanecem para operação avançada, compatibilidade e diagnóstico. O modo HTTP passa a ser explícito; não é requisito para abrir um projeto no Codex ou Claude Code.

## Identidade, IPC e ciclo de vida

O namespace continua derivado de repository, checkout e worktree, mas todos os caminhos são normalizados para absolutos depois de resolver a raiz selecionada. Um caminho relativo nunca depende de `process.cwd()` quando `--repo` aponta para outro local.

O endereço IPC, lock, manifest, banco de provenance, logs e diretórios dos backends ficam sob o namespace do `worktreeId`. No Windows, o adaptador usa named pipe com ACL exclusiva do usuário atual; em Unix, domain socket com modo `0600`. O manifest contém somente versão de protocolo, `worktreeId`, PID, endereço IPC e timestamps. O handshake valida esses campos e a identidade do processo; não existe nonce ou token persistido.

Cada conexão cria uma lease renovada por atividade e heartbeat a cada 10 segundos. A lease expira após 30 segundos sem renovação. Desconexão limpa remove a lease imediatamente e o supervisor inicia shutdown 5 segundos depois de ficar sem leases. Tempos e relógio são injetáveis para testes. Locks obsoletos só são recuperados após validar PID, identidade do processo e ausência de readiness. Crash de um gateway não encerra clientes restantes; crash do supervisor invalida as leases e permite recuperação coordenada.

## Isolamento dos backends

O layout padrão permanece fora do repositório em `<dataRoot>/projects/<worktreeId>`, evitando artefatos pesados no checkout, mas é fisicamente distinto por worktree. Uma opção project-local e um caminho absoluto customizado continuam disponíveis no setup.

AgentMemory gerenciado recebe data dir, credencial efêmera e portas loopback exclusivas para REST, streams, viewer e iii-engine. No Windows, depois da confirmação do usuário, o instalador baixa a versão fixada do iii-engine, valida checksum e armazena o binário somente no runtime isolado, sem alterar `PATH`. Readiness precisa provar o `worktreeId` esperado, não apenas responder HTTP.

Em modo remoto, Mega Brain não instala nem inicia AgentMemory ou iii-engine. O usuário fornece a URL e o nome da variável de ambiente do secret. Setup usa o valor somente em memória e executa um probe reversível: grava sentinela aleatório no namespace A, confirma presença em A e ausência em B e remove o registro. Falha ou cleanup incompleto mantém o wizard na etapa, permitindo tentar novamente ou trocar para gerenciado. O install não interativo retorna erro sem mutações.

O adaptador do Code Review Graph encaminha `CRG_DATA_DIR` e `CRG_REPO_ROOT` absolutos durante build, indexação e serve. Install verifica onde os artefatos foram escritos antes do commit. Uma versão que não consiga declarar ou provar armazenamento exclusivo é incompatível.

## Setup interativo

O wizard será uma máquina de estados separada da renderização do terminal, para permitir testes com respostas injetadas. Fluxo:

1. Diretório do projeto, com diretório atual como default.
2. Preflight completo de Node, Python, Git e compatibilidade da plataforma, ainda sem mutação.
3. Escolha de Codex, Claude Code ou ambos, com detecção como sugestão.
4. AgentMemory gerenciado (default) ou remoto; no remoto, URL e referência da variável de secret são validadas antes de avançar e a etapa permite retry ou troca para gerenciado.
5. Code Review Graph gerenciado (default) ou comando compatível customizado; defaults ou configuração avançada.
6. Localização de dados, isolamento estrito e opt-ins de egress/LLM.
7. Resumo sem segredos, confirmação e delegação ao instalador transacional.
8. Verificação final e instrução para reabrir o host.

Segredos não são gravados. O setup aceita o nome da variável que fornecerá a credencial, usa o valor apenas em memória para validação e persiste somente a referência. Cancelamento ou validação malsucedida em qualquer etapa anterior à confirmação não deixa arquivos, downloads ou processos. O install não interativo falha com código diferente de zero e precisa ser executado novamente após correção.

## Configuração canônica

Um resolver único recebe raiz do projeto, config local, `.env`, `--config`, ambiente do processo e flags. A precedência será, da maior para a menor:

1. flags CLI;
2. variáveis do processo;
3. `.env` da raiz selecionada;
4. arquivo passado por `--config` ou config local gerada pelo setup;
5. defaults do schema.

O resultado imutável carrega valor e origem redigida e é entregue a setup, install, mcp, start, serve, doctor e uninstall. `MEGA_BRAIN_PORT` só governa o modo HTTP explícito, mas passa a funcionar igualmente a partir do `.env`. Configuração de host contém comando e argumentos stdio, nunca tokens nem URLs dos MCPs internos.

## Transação e recuperação

Runtime e integrações formam uma única unidade de commit:

1. preflight e resolução read-only;
2. snapshot do runtime, manifests, hosts e hooks;
3. instalação, checksum, probe de isolamento e healthcheck em staging;
4. preparação das novas integrações;
5. swap do runtime e escrita atômica das integrações;
6. verificação pós-commit;
7. rollback completo de qualquer fase falha.

O rollback restaura bytes e existência dos arquivos, ponteiro do runtime, manifest, iii-engine, backends e processos anteriores. Staging e filhos novos são removidos. O uninstall primeiro impede novas leases, drena ou encerra as existentes e então restaura integrações. Dados são preservados por default e removidos somente por `--purge` explícito.

## Estratégia de testes

- Unitários: precedência/origem, resolução relativa, wizard, heartbeat e leases com relógio injetado.
- Integração: MCP stdio real, duas sessões no mesmo supervisor, ACL/permissão de IPC, rollback com falha injetada, data dirs, portas e readiness por identidade.
- Contrato: capabilities, probe remoto reversível, cleanup e localização efetiva do AgentMemory, iii-engine e CRG, sempre contra servidor falso ou descartável.
- Segurança: IPC restrito, tokens apenas em memória, redaction e limites de paths.
- E2E isolado: tarball em Node 22.22/Python 3.10+ e Node 24.19/Python 3.11+, configuração npm descartável, dois projetos simultâneos, sentinelas distintas, chamada das seis tools, fechamento de leases e uninstall sem processos órfãos.

## Compatibilidade e migração

Instalações HTTP existentes continuam reconhecidas. Upgrade prepara o runtime novo, substitui somente a entrada Mega Brain pela variante stdio e guarda o snapshot para rollback/uninstall. Entradas MCP e hooks de terceiros permanecem inalterados. `doctor` identifica configuração HTTP legada e oferece comando de migração; não altera arquivos implicitamente.
