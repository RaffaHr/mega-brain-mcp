# Spec: Hardening do ciclo de vida do produto

> feature: product-lifecycle-hardening
> status: auditada

## Contexto

Os testes existentes provam os componentes principalmente com doubles, mas ainda
não provam que um usuário consiga partir de um pacote distribuído, validar os
pré-requisitos antes de qualquer mutação, instalar os backends ausentes,
configurar Codex ou Claude Code, descobrir e usar as tools por MCP e remover o
produto restaurando as configurações anteriores. Esta feature fecha essa lacuna
com testes de pacote e cenários descartáveis em contêineres.

## Histórias

### US-013 — Falhar cedo quando o ambiente não é suportado

Como usuário, quero que a instalação valide todo o ambiente antes de baixar ou
alterar arquivos, para não deixar uma instalação parcial quando falta uma
dependência fundamental.

#### AC-030 — Preflight valida versões e comandos antes de mutar

- **Dado** Node anterior a 22.22.0, Python anterior a 3.10, Python ausente ou Git ausente
- **Quando** `mega-brain install` é executado
- **Então** a instalação termina com erro acionável antes de criar runtime, hooks, configuração MCP ou downloads de backends

#### AC-031 — Ambiente compatível instala os backends ausentes

- **Dado** Node 22.22 ou 24.19, Python 3.10+ e Git, sem AgentMemory nem Code Review Graph previamente instalados
- **Quando** `mega-brain install` é executado em modo gerenciado
- **Então** instala as versões fixadas em runtime isolado e registra no lock somente comandos realmente executáveis

### US-014 — Configurar o agente escolhido sem trabalho manual

Como usuário de Codex ou Claude Code, quero escolher o host na instalação, para
que MCP e hooks fiquem prontos e integrações existentes sejam preservadas.

#### AC-032 — Instalação configura MCP e hooks do host escolhido

- **Dado** uma configuração Codex, Claude Code ou ambas contendo entradas preexistentes
- **Quando** a instalação recebe `--hosts codex`, `--hosts claude` ou ambos
- **Então** mescla um único servidor Mega Brain e seus hooks nativos nos arquivos corretos sem expor os MCPs internos nem apagar entradas alheias

#### AC-033 — Upgrade e uninstall são idempotentes e restauradores

- **Dado** uma integração instalada e arquivos de host ou hooks Git preexistentes
- **Quando** upgrade ou uninstall padrão é executado repetidamente
- **Então** não duplica entradas, restaura o estado anterior byte a byte, remove o runtime e preserva dados; purge remove também os dados explícitos

### US-015 — Provar o funcionamento real do MCP

Como mantenedor, quero exercitar o processo e o protocolo reais, para que build
verde não esconda falhas de inicialização, healthcheck, descoberta ou
orquestração.

#### AC-034 — Runtime inicia e expõe somente seis tools públicas

- **Dado** uma instalação concluída com ambos os backends saudáveis
- **Quando** o runtime inicia, `doctor` roda e um cliente MCP conecta ao endpoint público
- **Então** healthchecks e handshakes passam e `tools/list` retorna exatamente as seis tools `brain_*`, com schemas válidos

#### AC-035 — Caso real usa AgentMemory, Code Review Graph e Git

- **Dado** um repositório fixture indexado e uma lição salva com evidência
- **Quando** um cliente chama aprendizado, recall, contexto de mudança, histórico, validação e status pelo MCP
- **Então** as respostas estruturadas mostram provenance real, respeitam freshness e demonstram a rota esperada entre os três backends sem expor tools internas

### US-016 — Distribuir e remover fora do checkout de desenvolvimento

Como usuário, quero instalar o artefato empacotado em um ambiente vazio, para
que o produto não dependa de npm link, node_modules ou arquivos do repositório
do mantenedor.

#### AC-036 — Tarball instala CLI funcional em ambiente vazio

- **Dado** apenas o tarball produzido por `npm pack` e um ambiente compatível
- **Quando** o pacote é instalado globalmente ou executado pelo binário publicado
- **Então** `mega-brain --help`, install, start, serve, doctor, stop e uninstall funcionam usando somente arquivos incluídos no pacote

#### AC-037 — Matriz isolada cobre sucesso e rejeições

- **Dado** contêineres descartáveis para Node 22.22/Python 3.10+, Node abaixo do piso e Python ausente ou antigo
- **Quando** o harness de ciclo de vida executa cada cenário
- **Então** o cenário suportado conclui o ciclo e os cenários incompatíveis falham antes de qualquer efeito colateral verificável

#### AC-038 — Documentação corresponde ao pacote e ao setup automático

- **Dado** o nome npm com escopo, os hosts suportados e os requisitos efetivos
- **Quando** um usuário segue o README e o troubleshooting a partir de uma máquina limpa
- **Então** encontra comandos copiáveis para instalar do registro ou tarball, escolher o host, configurar variáveis, verificar MCP/hooks e desinstalar

## Fora de escopo

- Publicar no registro npm durante esta feature; o boundary publicado será
  comprovado por tarball e a publicação permanece uma ação externa separada.
- Suportar hosts além de Codex e Claude Code.
- Habilitar egress, LLM ou recursos pagos do AgentMemory por padrão.
- Alterar as versões compatíveis fixadas de AgentMemory 0.9.29 e Code Review Graph 2.3.7 sem uma falha de compatibilidade comprovada.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-008 | Um tarball de `npm pack` é suficiente para provar o boundary do pacote antes da publicação no registro. | confirmada | O usuário autorizou testar sem registro npm; o mesmo artefato é consumido por `npm install`. |
| ASM-009 | Docker local pode representar ambientes Linux descartáveis para a matriz negativa e o ciclo real. | confirmada | Docker Engine 29.5.2 está disponível e saudável nesta máquina. |
| ASM-010 | A escolha de host deve configurar tanto MCP quanto hooks, não apenas gerar instruções manuais. | confirmada | O pedido exige setup de MCPs e instalação dos hooks nativos para Codex ou Claude Code. |

## Perguntas em aberto

Nenhuma. A publicação no npm não é necessária para comprovar o pacote e não
será feita sem uma autorização externa separada.
