import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, test } from 'vitest';

import { installManagedRuntime } from '../../src/cli/install.js';
import { uninstallMegaBrain } from '../../src/cli/uninstall.js';
import { writeProjectConfig } from '../../src/config/project-config.js';
import { discoverProjectIdentity } from '../../src/projects/identity.js';
import { runtimeLayout } from '../../src/runtime/layout.js';
import { readSupervisorManifest } from '../../src/runtime/supervisor-manifest.js';
import { PUBLIC_TOOL_NAMES } from '../../src/server/index.js';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('fixture did not bind a TCP port'));
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 12_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() >= deadline) throw new Error('autonomous runtime did not shut down before timeout');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test('AC-039/041/044: cliente stdio real inicia, usa seis tools e encerra o supervisor autônomo @spec:AC-039 @spec:AC-041 @spec:AC-044', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'mega-brain-autonomous-e2e-'));
  const repository = path.join(temporary, 'repository');
  const dataDir = path.join(temporary, 'data');
  await mkdir(repository, { recursive: true });
  await writeFile(path.join(repository, 'example.ts'), 'export const handler = () => "ok";\n');
  await execFileAsync('git', ['init', repository]);
  await execFileAsync('git', ['-C', repository, 'config', 'user.name', 'Mega Brain E2E']);
  await execFileAsync('git', ['-C', repository, 'config', 'user.email', 'mega-brain@example.test']);
  await execFileAsync('git', ['-C', repository, 'add', 'example.ts']);
  await execFileAsync('git', ['-C', repository, 'commit', '-m', 'add autonomous handler architecture']);
  const memories = new Map<string, Array<Record<string, unknown>>>();
  const agentMemory = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> : {};
    const project = String(body.project ?? new URL(request.url ?? '/', 'http://fixture').searchParams.get('project') ?? 'default');
    const projectMemories = memories.get(project) ?? [];
    let payload: Record<string, unknown> = {};
    if (request.url?.endsWith('/health')) payload = { status: 'healthy', healthy: true, version: '0.9.29' };
    else if (request.url?.endsWith('/livez')) payload = { status: 'ok' };
    else if (request.url?.endsWith('/remember')) {
      const record = { id: `${project}-${projectMemories.length + 1}`, content: String(body.content), project, metadata: body.metadata ?? {}, score: 0.99, createdAt: new Date().toISOString() };
      projectMemories.push(record);
      memories.set(project, projectMemories);
      payload = { id: record.id };
    } else if (request.url?.endsWith('/smart-search')) payload = { results: projectMemories };
    else if (request.url?.endsWith('/memories')) payload = { memories: projectMemories, total: projectMemories.length, offset: 0, limit: null };
    else if (request.url?.startsWith('/agentmemory/sessions')) payload = { sessions: [] };
    else payload = { status: 'ok' };
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(payload));
  });
  const baseUrl = await listen(agentMemory);
  const identity = await discoverProjectIdentity(repository);
  const crgFixture = fileURLToPath(new URL('../fixtures/crg-mcp.mjs', import.meta.url));
  let client: Client | undefined;
  try {
    const manifest = await installManagedRuntime({
      dataDir,
      identity,
      agentMemoryMode: 'remote',
      remoteAgentMemory: { baseUrl, secretEnvVar: 'REMOTE_MEMORY_SECRET' },
      remoteIsolationProbe: async () => undefined,
      codeReviewGraph: { mode: 'custom', command: process.execPath, args: [crgFixture] },
      runner: { run: async () => undefined },
      preflight: false,
      validateArtifacts: false,
    });
    await writeProjectConfig(repository, {
      dataDir,
      port: 3000,
      logLevel: 'info',
      allowEgress: false,
      allowLlm: false,
      agentMemory: { mode: 'remote', baseUrl, secretEnvVar: 'REMOTE_MEMORY_SECRET', ports: manifest.isolation!.ports, environment: {} },
      codeReviewGraph: { command: process.execPath, args: [crgFixture], dataDir: manifest.isolation!.paths.codeReviewGraph, environment: {} },
      projects: {},
    });
    const environment = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, 'dist', 'cli', 'index.js'), 'mcp', '--repo', repository],
      env: { ...environment, REMOTE_MEMORY_SECRET: 'runtime-only-secret' },
      stderr: 'pipe',
    });
    client = new Client({ name: 'autonomous-e2e', version: '1.0.0' });
    await client.connect(transport);
    expect((await client.listTools()).tools.map(({ name }) => name)).toEqual(PUBLIC_TOOL_NAMES);
    const learned = await client.callTool({ name: 'brain_learn', arguments: { statement: 'autonomous sentinel decision', type: 'decision' } });
    const memoryId = String('structuredContent' in learned ? learned.structuredContent?.result?.memoryId : '');
    const calls = await Promise.all([
      client.callTool({ name: 'brain_recall', arguments: { query: 'autonomous sentinel' } }),
      client.callTool({ name: 'brain_change_context', arguments: { target: 'example.ts' } }),
      client.callTool({ name: 'brain_history', arguments: { limit: 5 } }),
      client.callTool({ name: 'brain_validate', arguments: { memoryId, outcome: 'confirmed', evidence: ['autonomous-e2e'] } }),
      client.callTool({ name: 'brain_status', arguments: {} }),
    ]);
    const failures = [learned, ...calls].flatMap((result, index) => ('isError' in result && result.isError)
      ? [{ index, content: result.content }]
      : []);
    expect(failures).toEqual([]);
    await client.close();
    client = undefined;
    const layout = runtimeLayout(dataDir, identity);
    await waitUntil(async () => access(path.join(layout.projectRoot, 'supervisor', 'manifest.json')).then(() => false).catch(() => true));
    await expect(access(layout.stateFile)).rejects.toMatchObject({ code: 'ENOENT' });
    await uninstallMegaBrain({ dataDir, identity });
  } finally {
    await client?.close().catch(() => undefined);
    const layout = runtimeLayout(dataDir, identity);
    await readSupervisorManifest(layout).then((manifest) => process.kill(manifest.pid, 'SIGTERM')).catch(() => undefined);
    agentMemory.closeAllConnections();
    await new Promise<void>((resolve) => agentMemory.close(() => resolve()));
    await rm(temporary, { recursive: true, force: true });
  }
}, 60_000);
