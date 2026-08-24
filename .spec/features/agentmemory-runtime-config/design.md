# Design: Configuração de runtime do AgentMemory

## Modos

- `managed` (padrão): instala AgentMemory travado, inicia o daemon local e
  injeta no processo somente variáveis nativas allowlisted.
- `remote`: usa `MEGA_BRAIN_AGENTMEMORY_URL` e
  `MEGA_BRAIN_AGENTMEMORY_TOKEN`; não instala nem inicia AgentMemory local.

O Code Review Graph continua gerenciado e isolado por checkout nos dois modos.

## Fontes e precedência

1. Variáveis do processo do Mega Brain.
2. `.env` localizado na raiz selecionada por `--repo`.
3. Arquivo JSON passado por `--config`.
4. Defaults internos.

Variáveis diretas reconhecidas do AgentMemory vencem o mapa avançado
`MEGA_BRAIN_AGENTMEMORY_ENV_JSON`. O modo remoto ignora opções locais, evitando
que credenciais do host sejam confundidas com configuração de uma VPS.

## Segurança

- Uma allowlist explícita substitui o regex amplo para o AgentMemory.
- Credenciais de embeddings remotos exigem egress; credenciais LLM também
  exigem opt-in de LLM.
- Flags com consumo LLM são recusadas sem ambos os opt-ins.
- `AGENTMEMORY_SECRET` é passado apenas em memória e vira o bearer token do
  cliente local quando `MEGA_BRAIN_AGENTMEMORY_TOKEN` não foi definido.
- O runtime-lock registra modo, comandos e versões, nunca environment/secrets.

## Compatibilidade Node

`mcp-use@1.34.6` aceita Node `>=22.12`, enquanto `posthog-node@5.24.17` exige
`>=22.22`. Portanto, o intervalo comum e o piso oficial do Mega Brain serão
`>=22.22.0`; a CI cobrirá Node 22.22 e 24.19 sem rebaixar dependências.
