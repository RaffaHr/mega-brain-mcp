import { execFile } from 'node:child_process';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from 'vitest';
import { AgentMemoryClient } from '../../src/adapters/agentmemory/client.js';
import { CodeReviewGraphClient } from '../../src/adapters/code-review-graph/client.js';
import { GitRepository } from '../../src/adapters/git/repository.js';
import { loadConfig } from '../../src/config/load.js';
import { discoverProjectIdentity } from '../../src/projects/identity.js';
import { openProvenanceDatabase } from '../../src/provenance/database.js';
import { ProvenanceRepository } from '../../src/provenance/repository.js';
import { createApplicationHandlers } from '../../src/server/application.js';
import { createMegaBrainServer, listenMegaBrainServer, PUBLIC_TOOL_NAMES } from '../../src/server/index.js';

const execFileAsync = promisify(execFile);

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate test port');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function listen(server: HttpServer): Promise<string> {
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not start AgentMemory fixture');
  return `http://127.0.0.1:${address.port}`;
}

function closeHttp(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('AC-035: real MCP orchestration routes through AgentMemory HTTP, CRG stdio and Git @spec:AC-035', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mega-brain-real-orchestration-'));
  const repo = path.join(root, 'repo');
  const dataDir = path.join(root, 'data');
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'example.ts'), 'export const exampleHandler = () => "ok";\n', 'utf8');
  await execFileAsync('git', ['init', repo]);
  await execFileAsync('git', ['-C', repo, 'config', 'user.name', 'Mega Brain Test']);
  await execFileAsync('git', ['-C', repo, 'config', 'user.email', 'mega-brain@example.test']);
  await execFileAsync('git', ['-C', repo, 'add', 'src/example.ts']);
  await execFileAsync('git', ['-C', repo, 'commit', '-m', 'add explicit handler architecture']);

  const memories: Array<{ id: string; content: string; project: string; metadata: Record<string, unknown>; createdAt: string; score: number }> = [];
  const agentMemoryRequests: string[] = [];
  const agentMemoryServer = createHttpServer(async (request, response) => {
    const url = request.url ?? '/';
    agentMemoryRequests.push(`${request.method} ${url}`);
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {};
    let payload: Record<string, unknown> = {};
    if (url.endsWith('/livez')) payload = { status: 'ok' };
    else if (url.endsWith('/health')) payload = { status: 'healthy', healthy: true, version: '0.9.29' };
    else if (url.endsWith('/remember')) {
      const id = `memory-${memories.length + 1}`;
      memories.push({ id, content: String(body.content), project: String(body.project), metadata: (body.metadata ?? {}) as Record<string, unknown>, createdAt: new Date().toISOString(), score: 0.99 });
      payload = { id };
    } else if (url.endsWith('/smart-search')) payload = { results: memories };
    else if (url.endsWith('/memories')) payload = { memories, total: memories.length, offset: 0, limit: null };
    else if (url.startsWith('/agentmemory/sessions')) payload = { sessions: [] };
    else if (url.endsWith('/verify')) payload = { verified: true };
    else { response.statusCode = 404; payload = { error: 'not found' }; }
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(payload));
  });
  const agentMemoryUrl = await listen(agentMemoryServer);
  const identity = await discoverProjectIdentity(repo);
  const git = await GitRepository.discover(repo);
  const head = await git.head();
  const blobHash = (await git.run(['rev-parse', 'HEAD:src/example.ts'])).trim();
  const config = await loadConfig({ repoPath: repo, envFilePath: false, env: {
    MEGA_BRAIN_DATA_DIR: dataDir,
    MEGA_BRAIN_AGENTMEMORY_MODE: 'remote',
    MEGA_BRAIN_AGENTMEMORY_URL: agentMemoryUrl,
    MEGA_BRAIN_AGENTMEMORY_TOKEN: 'runtime-only-secret',
  } });
  const crgFixture = fileURLToPath(new URL('../fixtures/crg-mcp.mjs', import.meta.url));
  const codeReviewGraph = new CodeReviewGraphClient({
    command: process.execPath,
    args: [crgFixture],
    cwd: repo,
    environment: { CRG_FIXTURE_HEAD: head },
    timeoutMs: 10_000,
  });
  const database = openProvenanceDatabase(path.join(dataDir, 'provenance.sqlite'));
  const application = createMegaBrainServer(createApplicationHandlers({
    config,
    identity,
    git,
    agentMemory: new AgentMemoryClient({ baseUrl: agentMemoryUrl, authToken: config.agentMemory.authToken }),
    codeReviewGraph,
    provenance: new ProvenanceRepository(database),
  }));
  const port = await freePort();
  const client = new Client({ name: 'mega-brain-real-e2e', version: '1.0.0' });
  try {
    await listenMegaBrainServer(application, port);
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
    expect((await client.listTools()).tools.map(({ name }) => name)).toEqual(PUBLIC_TOOL_NAMES);

    const learned = await client.callTool({ name: 'brain_learn', arguments: {
      statement: 'Architecture decisions keep handlers explicit',
      type: 'decision',
      evidence: [{ path: 'src/example.ts', blobHash, commitHash: head }],
    } });
    const memoryId = String('structuredContent' in learned ? learned.structuredContent?.result?.memoryId : '');
    expect(memoryId).toBe('memory-1');

    const recall = await client.callTool({ name: 'brain_recall', arguments: { query: 'architecture explicit handler', intent: 'architecture' } });
    const change = await client.callTool({ name: 'brain_change_context', arguments: { target: 'src/example.ts' } });
    const history = await client.callTool({ name: 'brain_history', arguments: { limit: 10 } });
    const validation = await client.callTool({ name: 'brain_validate', arguments: { memoryId, outcome: 'confirmed', evidence: [head] } });
    const status = await client.callTool({ name: 'brain_status', arguments: { verbose: true } });
    const results = [learned, recall, change, history, validation, status];
    expect(results.every((result) => 'structuredContent' in result && result.structuredContent?.schemaVersion === '1.0')).toBe(true);
    expect('structuredContent' in recall ? recall.structuredContent?.sources : []).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'agentmemory' }),
      expect.objectContaining({ kind: 'code_review_graph' }),
      expect.objectContaining({ kind: 'git' }),
    ]));
    expect('structuredContent' in validation ? validation.structuredContent?.freshness : null).toBe('FRESH');
    expect('structuredContent' in status ? status.structuredContent?.status : null).toBe('ok');
    expect(agentMemoryRequests).toEqual(expect.arrayContaining(['POST /agentmemory/remember', 'POST /agentmemory/smart-search', 'GET /agentmemory/health']));
  } finally {
    await client.close().catch(() => undefined);
    await application.forceClose().catch(() => undefined);
    await codeReviewGraph.stop().catch(() => undefined);
    database.close();
    await closeHttp(agentMemoryServer).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);
