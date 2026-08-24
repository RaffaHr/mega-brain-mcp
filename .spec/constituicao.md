# Constituição — Mega Brain MCP v1.0.0

Princípios inegociáveis que valem para toda feature do projeto.

## P-001 [DEVE] Todo requisito tem prova executável

Nenhuma feature é declarada pronta sem `onp-spec audit --ci` com exit code 0.

- verificação(gate): intrínseca ao audit

## P-002 [DEVE] Segredos nunca são persistidos nem expostos

Payloads, logs, diagnósticos, memórias e respostas devem redigir credenciais,
tokens, cookies, chaves privadas, headers de autorização e valores sensíveis.

- verificação(teste): @principle:P-002

## P-003 [DEVE] Conhecimento sobre código nunca é declarado atual sem evidência atual

Uma memória sobre implementação só pode ser `FRESH` quando suas evidências
continuarem válidas no HEAD e na working tree do checkout correto.

- verificação(teste): @principle:P-003

## P-004 [DEVE] Ferramentas públicas de consulta não alteram o repositório

Recall, histórico, validação, contexto de mudança e status são operações
read-only sobre o projeto do usuário.

- verificação(teste): @principle:P-004

## P-005 [DEVE] Os MCPs internos permanecem privados e com privilégio mínimo

O host enxerga apenas as seis tools do Mega Brain. Tools mutantes dos backends,
incluindo refactors do Code Review Graph, não são expostas nem invocadas por
fluxos de consulta.

- verificação(teste): @principle:P-005

## P-006 [DEVE] Hooks preservam integrações existentes e falham de forma aberta

Instalar, atualizar ou remover hooks nunca apaga hooks alheios; indisponibilidade
do Mega Brain não bloqueia o uso normal do host ou do Git.

- verificação(teste): @principle:P-006

## P-007 [DEVE] Egress e consumo de LLM são opt-in

O produto funciona localmente sem chave. Dados só podem alcançar embeddings ou
LLMs externos após configuração explícita e diagnosticável do usuário.

- verificação(teste): @principle:P-007

## P-008 [RECOMENDADO] Integrações são adaptadores versionados

Contratos do AgentMemory, Code Review Graph, Git, Codex e Claude Code ficam
isolados atrás de interfaces com capability negotiation e testes de contrato.

## P-009 [RECOMENDADO] Contexto mínimo é preferido a exploração ampla

O sistema prioriza memória validada e grafo estrutural, recorrendo à leitura
direta somente quando as fontes anteriores forem insuficientes.
