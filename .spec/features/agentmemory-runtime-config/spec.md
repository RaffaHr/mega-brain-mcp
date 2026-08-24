# Spec: Configuração de runtime do AgentMemory

> feature: agentmemory-runtime-config
> status: implementada

## Contexto

O Mega Brain precisa distinguir um AgentMemory já operado remotamente de uma
instância instalada e iniciada pelo próprio Mega Brain. Hoje a URL e o token
remotos funcionam, mas variáveis nativas colocadas no `.env` não são lidas nem
encaminhadas ao processo gerenciado. O exemplo também mistura opções locais,
credenciais e nomes de variáveis que não pertencem ao contrato oficial.

## Histórias

### US-011 — Escolher explicitamente o modo do AgentMemory

Como mantenedor, quero selecionar AgentMemory remoto ou gerenciado, para que o
Mega Brain não instale serviços desnecessários e encaminhe apenas a configuração
aplicável a cada modo.

#### AC-026 — Modo remoto usa somente conexão

- **Dado** `MEGA_BRAIN_AGENTMEMORY_MODE=remote` com URL e token
- **Quando** a configuração e a instalação do Mega Brain são executadas
- **Então** o cliente usa a URL/token informados e o instalador não instala nem inicia um AgentMemory local

#### AC-027 — Modo gerenciado recebe configuração nativa segura

- **Dado** `MEGA_BRAIN_AGENTMEMORY_MODE=managed` e variáveis reconhecidas do AgentMemory no `.env`
- **Quando** o Mega Brain instala e inicia o runtime
- **Então** encaminha as variáveis permitidas ao processo AgentMemory sem gravar secrets no runtime-lock, usando `AGENTMEMORY_SECRET` também na autenticação REST quando não houver token explícito

#### AC-028 — Recursos remotos e com LLM exigem opt-in

- **Dado** credenciais de provedor ou recursos AgentMemory que podem consumir rede ou LLM
- **Quando** a configuração é carregada sem os opt-ins correspondentes
- **Então** a configuração é recusada com erro acionável; com os opt-ins, somente as credenciais permitidas são encaminhadas e permanecem redigidas

### US-012 — Executar na versão Node disponível

Como mantenedor, quero usar uma versão Node compatível com todas as dependências, para que o Mega Brain rode
no mesmo ambiente onde AgentMemory e Code Review Graph já funcionam.

#### AC-029 — Node 22.22 é o piso da matriz suportada

- **Dado** o pacote e suas dependências transitivas fixadas
- **Quando** instalação, build, testes e auditoria são executados com Node 22.22 e Node 24.19
- **Então** não há incompatibilidade de engine, regressão funcional ou vulnerabilidade de produção conhecida

## Fora de escopo

- Provisionar ou administrar a VPS remota do AgentMemory.
- Encaminhar todas as variáveis do processo hospedeiro sem allowlist.
- Habilitar LLM, embeddings remotos, consolidação, reflexão ou extração de grafo por padrão.
- Alterar as versões travadas de AgentMemory `0.9.29` ou Code Review Graph `2.3.7`.

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-006 | Node `>=22.22.0` é o menor intervalo comum declarado pelo pacote e por todas as dependências instaladas. | confirmada | Decisão do usuário em 24/08/2026; cobre também Node 24.19. |
| ASM-007 | O modo padrão deve continuar gerenciado para preservar o fluxo atual de `mega-brain install`. | confirmada | Compatibilidade retroativa com a v1 já implementada. |

## Perguntas em aberto

Nenhuma. O usuário definiu que URL/token bastam no modo remoto, enquanto a
configuração nativa é necessária quando o Mega Brain instala o AgentMemory.
