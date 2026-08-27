# Spec: P2 symbol lifecycle git intelligence

> feature: p2-symbol-lifecycle-git-intelligence
> status: pronta

## Contexto

Introduz ciclo de vida de memória orientado a símbolos AST (evitando invalidações falsas por mudanças de formatação em arquivos) e mineração de acoplamento temporal (co-change coupling) no Git.

## Histórias

### US-030 — Invalidação granular e ciclo de vida por símbolo AST

Como sistema de proveniência, quero que memórias ancoradas a funções ou classes específicas sejam revalidadas com base no hash do corpo do símbolo AST, para não invalidar regras de negócio quando outras partes do mesmo arquivo forem alteradas.

#### AC-078 — Preservação de status FRESH quando símbolo específico não foi alterado

- **Dado** uma memória com evidência vinculada ao símbolo `validateToken` no arquivo `src/auth.ts`
- **Quando** outro símbolo no arquivo `src/auth.ts` for modificado e commitado
- **Então** o avaliador de frescor deve manter a memória como `FRESH` se o hash AST do símbolo `validateToken` permanecer inalterado

#### AC-079 — Transição para STALE apenas quando o hash do símbolo for modificado

- **Dado** uma memória ancorada a um símbolo com hash AST registrado
- **Quando** o corpo da função do símbolo for modificado no repositório
- **Então** o estado da memória deve transicionar para `STALE` e registrar evento de invalidação específico na proveniência

### US-031 — Mineração de acoplamento temporal (co-change coupling) no Git

Como agente planejando alterações em `brain_change_context`, quero ser avisado sobre arquivos que frequentemente mudam juntos no histórico de commits do Git, para evitar que refatorações esqueçam arquivos correlacionados sem imports explícitos.

#### AC-080 — Detecção de arquivos com acoplamento temporal histórico

- **Dado** um arquivo alvo passado para `brain_change_context`
- **Quando** a análise de histórico Git minerar os commits dos últimos 6 meses
- **Então** arquivos com taxa de co-mudança superior a 40% em relação ao alvo devem ser retornados no campo `coChangedFiles` do envelope

#### AC-081 — Cálculo de risco de alteração baseado em churn e acoplamento

- **Dado** um arquivo com alta frequência de modificações recentes e múltiplos arquivos acoplados temporalmente
- **Quando** `brain_change_context` calcular o resumo de impacto
- **Então** um aviso de risco arquitetural deve ser anexado aos metadados do envelope para orientar a cautela do agente

## Fora de escopo

- Suporte a parsers de linguagens fora do ecossistema principal do projeto (TypeScript/JavaScript/Python)

## Suposições

| ID | Suposição | Status | Resolução |
|---|---|---|---|
| ASM-022 | O histórico local do Git possui profundidade suficiente para cálculo estatístico de co-mudança em repositórios com mais de 10 commits | confirmada | Validado no repositório de teste |

## Perguntas em aberto

Nenhuma.
