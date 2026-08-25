import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

export const III_ENGINE_VERSION = '0.11.2' as const;

export function sha256Artifact(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function extractZipEntry(archive: Uint8Array, expectedName: string): Uint8Array {
  const buffer = Buffer.from(archive);
  for (let offset = 0; offset <= buffer.length - 46; offset += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) continue;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (path.basename(name).toLowerCase() === expectedName.toLowerCase()) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Invalid iii-engine ZIP local header');
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
      const extracted = method === 0 ? compressed : method === 8 ? inflateRawSync(compressed) : null;
      if (!extracted || extracted.length !== uncompressedSize) throw new Error('Unsupported or corrupt iii-engine ZIP entry');
      return extracted;
    }
    offset += 45 + nameLength + extraLength + commentLength;
  }
  throw new Error(`iii-engine archive does not contain ${expectedName}`);
}

export interface OfficialIiiEngineArtifact {
  bytes: Uint8Array;
  sha256: string;
  sourceUrl: string;
}

export async function downloadOfficialIiiEngine(input: {
  architecture?: NodeJS.Architecture;
  fetch?: typeof globalThis.fetch;
} = {}): Promise<OfficialIiiEngineArtifact> {
  const architecture = input.architecture ?? process.arch;
  const target = architecture === 'x64'
    ? 'x86_64-pc-windows-msvc'
    : architecture === 'arm64' ? 'aarch64-pc-windows-msvc' : null;
  if (!target) throw new Error(`iii-engine 0.11.2 has no supported Windows artifact for ${architecture}`);
  const filename = `iii-${target}.zip`;
  const releaseRoot = 'https://github.com/iii-hq/iii/releases/download/iii%2Fv0.11.2';
  const sourceUrl = `${releaseRoot}/${filename}`;
  const fetch = input.fetch ?? globalThis.fetch;
  const [checksumResponse, archiveResponse] = await Promise.all([
    fetch(`${releaseRoot}/iii-${target}.sha256`),
    fetch(sourceUrl),
  ]);
  if (!checksumResponse.ok || !archiveResponse.ok) {
    throw new Error(`Could not download the official iii-engine ${III_ENGINE_VERSION} artifact and checksum`);
  }
  const checksumText = await checksumResponse.text();
  const expectedArchiveSha = checksumText.match(/\b[a-f0-9]{64}\b/iu)?.[0]?.toLowerCase();
  if (!expectedArchiveSha) throw new Error('Official iii-engine checksum file is invalid');
  const archive = new Uint8Array(await archiveResponse.arrayBuffer());
  if (sha256Artifact(archive) !== expectedArchiveSha) throw new Error('Official iii-engine archive checksum mismatch');
  const bytes = extractZipEntry(archive, 'iii.exe');
  return { bytes, sha256: sha256Artifact(bytes), sourceUrl };
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
