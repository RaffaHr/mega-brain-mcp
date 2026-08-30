import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Compiles the package before the suite runs.
 *
 * Tests that exercise the shipped CLI read `dist/`, so leaving the build to
 * whichever test happens to run first makes them depend on execution order and
 * fail on a clean checkout. Running `tsc` here is the same step CI performs
 * before `npm test`.
 */
export default async function setup(): Promise<void> {
  try {
    await execFileAsync(process.execPath, [
      path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
      '-p',
      path.join(root, 'tsconfig.json'),
    ], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch (error) {
    const { stdout = '', stderr = '' } = error as { stdout?: string; stderr?: string };
    const diagnostics = `${stdout}\n${stderr}`.trim();
    throw new Error(`Test suite build failed\n${diagnostics || String(error)}`);
  }
}
