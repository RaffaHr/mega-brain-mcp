import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const III_ENGINE_VERSION = '0.11.2' as const;

export function sha256Artifact(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function installIiiEngineArtifact(input: {
  destination: string;
  version: typeof III_ENGINE_VERSION;
  confirmed: boolean;
  expectedSha256: string;
  download(): Promise<Uint8Array>;
}): Promise<void> {
  if (!input.confirmed) throw new Error('iii-engine installation requires explicit user confirmation');
  if (!/^[a-f0-9]{64}$/u.test(input.expectedSha256)) throw new Error('Invalid iii-engine checksum');
  const artifact = await input.download();
  const actual = sha256Artifact(artifact);
  if (actual !== input.expectedSha256) throw new Error(`iii-engine checksum mismatch for ${input.version}`);

  await mkdir(path.dirname(input.destination), { recursive: true });
  const temporary = `${input.destination}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, artifact, { flag: 'wx', mode: 0o700 });
    if (process.platform !== 'win32') await chmod(temporary, 0o700);
    await rename(temporary, input.destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
