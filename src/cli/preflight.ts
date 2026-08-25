import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const MINIMUM_VERSIONS = { node: '22.22.0', python: '3.10.0' } as const;

export interface ProbeResult { stdout: string; stderr: string }
export interface PreflightProbe { run(command: string, args: string[]): Promise<ProbeResult> }
export interface InstallPreflightOptions {
  nodeVersion?: string;
  pythonCommand?: string;
  platform?: NodeJS.Platform;
  probe?: PreflightProbe;
}
export interface InstallPreflightResult {
  nodeVersion: string;
  pythonVersion: string;
  pythonCommand: string;
  gitVersion: string;
  npmVersion: string;
}

export function npmInvocation(platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  if (platform !== 'win32') return { command: 'npm', args: [] };
  const npmCli = process.env.npm_execpath ?? path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return { command: process.execPath, args: [npmCli] };
}

export const systemPreflightProbe: PreflightProbe = {
  async run(command, args) {
    try {
      const result = await execFileAsync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
      const details = [failure.stdout, failure.stderr, failure.message].filter(Boolean).join('\n').trim();
      throw new Error(details || `Could not execute ${command}`);
    }
  },
};

function versionTuple(value: string): [number, number, number] | null {
  const match = value.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
}

export function versionAtLeast(actual: string, minimum: string): boolean {
  const left = versionTuple(actual);
  const right = versionTuple(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index]! > right[index]!;
  }
  return true;
}

function detectedVersion(label: string, result: ProbeResult): string {
  const combined = `${result.stdout}\n${result.stderr}`.trim();
  const parsed = versionTuple(combined);
  if (!parsed) throw new Error(`Could not determine ${label} version from: ${combined || '(empty output)'}`);
  return parsed.join('.');
}

async function requiredCommand(probe: PreflightProbe, command: string, args: string[], label: string): Promise<ProbeResult> {
  try {
    return await probe.run(command, args);
  } catch (error) {
    throw new Error(`${label} is required but '${command}' could not be executed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function runInstallPreflight(options: InstallPreflightOptions = {}): Promise<InstallPreflightResult> {
  const probe = options.probe ?? systemPreflightProbe;
  const platform = options.platform ?? process.platform;
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  if (!versionAtLeast(nodeVersion, MINIMUM_VERSIONS.node)) {
    throw new Error(`Unsupported Node.js ${nodeVersion}; Mega Brain requires Node.js >=${MINIMUM_VERSIONS.node}. No files were changed.`);
  }

  const npm = npmInvocation(platform);
  const npmVersion = detectedVersion('npm', await requiredCommand(probe, npm.command, [...npm.args, '--version'], 'npm'));
  const gitVersion = detectedVersion('Git', await requiredCommand(probe, 'git', ['--version'], 'Git'));
  const candidates = options.pythonCommand ? [options.pythonCommand] : platform === 'win32' ? ['python.exe', 'python3.exe'] : ['python3', 'python'];
  const failures: string[] = [];
  for (const pythonCommand of candidates) {
    try {
      const pythonVersion = detectedVersion('Python', await probe.run(pythonCommand, ['--version']));
      if (!versionAtLeast(pythonVersion, MINIMUM_VERSIONS.python)) {
        failures.push(`${pythonCommand} reported ${pythonVersion}, minimum is ${MINIMUM_VERSIONS.python}`);
        continue;
      }
      await probe.run(pythonCommand, ['-c', 'import ensurepip, venv']);
      return { nodeVersion, pythonVersion, pythonCommand, gitVersion, npmVersion };
    } catch (error) {
      failures.push(`${pythonCommand}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`Python >=${MINIMUM_VERSIONS.python} with venv and ensurepip is required. ${failures.join('; ')}. No files were changed.`);
}
