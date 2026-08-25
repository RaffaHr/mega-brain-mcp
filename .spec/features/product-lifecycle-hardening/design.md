# Design: Hardening do ciclo de vida do produto

## Estratégia de prova

A suíte existente continua responsável pelos contratos rápidos. A nova camada
adiciona três limites que esses testes não cobrem: processo filho real, pacote
instalado fora do checkout e sistema operacional descartável. O mesmo tarball
gerado por `npm pack` será usado no teste local e na CI.

## Fases do instalador

1. Resolver o repositório e ler configuração sem criar arquivos.
2. Executar preflight de Node, Python e Git e produzir um relatório estruturado.
3. Preparar runtime em staging e instalar versões fixadas.
4. Validar entrypoints e lock antes do swap atômico.
5. Mesclar MCP e hooks somente depois do runtime válido.
6. Em qualquer falha, restaurar integrações e runtime anterior.

Nenhum download, diretório de runtime ou arquivo de host pode existir antes do
preflight completo. O relatório de erro deve distinguir comando ausente de
versão incompatível.

## Integração de hosts

- Codex: configuração MCP por projeto e hooks nativos no diretório `.codex`.
- Claude Code: `.mcp.json` por projeto e hooks em `.claude/settings.local.json`.
- O host recebe apenas o endpoint do Mega Brain; AgentMemory e Code Review
  Graph permanecem processos privados.
- Backups guardam existência, caminho e bytes originais. A reinstalação é
  idempotente; uninstall restaura o snapshot original.

Os formatos exatos serão validados contra a documentação oficial e contra
fixtures de merge, incluindo arquivo inexistente, JSON existente e entradas de
terceiros.

## Runtime e prontidão

`start` inicia daemons gerenciados e espera liveness com timeout; `serve`
continua sendo o endpoint MCP público. `doctor` valida runtime, REST do
AgentMemory, initialize/tools-list do CRG, hooks e divergência Git. O teste real
usa o SDK MCP contra `/mcp`, chama as seis tools e verifica `structuredContent`.

## Matriz isolada

| Cenário | Node | Python | Resultado |
|---|---:|---:|---|
| Suportado mínimo | 22.22.0 | 3.10+ | ciclo completo |
| Suportado atual | 24.19.0 | 3.11+ | ciclo completo |
| Node antigo | abaixo de 22.22.0 | 3.10+ | falha sem mutação |
| Python ausente | 22.22.0 | ausente | falha sem mutação |
| Python antigo | 22.22.0 | abaixo de 3.10 | falha sem mutação |

O harness monta somente o tarball e uma fixture Git em contêineres descartáveis.
Ele não monta `node_modules`, `src` ou `dist` do checkout.

## Boundary de publicação

A feature não executa `npm publish`. Ela prova o mesmo conteúdo que seria
publicado usando `npm pack`, instalação global e execução do binário. O workflow
de release pode publicar depois, com autorização e credenciais próprias.
