import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

import { main } from "../../src/cli/index.js";
import { installManagedRuntime } from "../../src/cli/install.js";
import { discoverProjectIdentity } from "../../src/projects/identity.js";
import { writeProjectConfig } from "../../src/config/project-config.js";
import { sha256Artifact } from "../../src/runtime/iii-engine.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((d) => rm(d, { recursive: true, force: true }))));

test("doctor in unprovisioned git repository returns Project Not provisioned and no false backend warnings", async () => {
  const repoDir = await mkdtemp(path.join(tmpdir(), "mega-brain-doc-unprov-"));
  temporaryDirectories.push(repoDir);
  await execFileAsync("git", ["-C", repoDir, "init"]);

  const outputs: string[] = [];
  await main(["doctor", "--repo", repoDir, "--json"], (msg) => outputs.push(msg));

  const jsonStr = outputs.join("\n");
  const result = JSON.parse(jsonStr);

  expect(result.warnings).toEqual([]);
  expect(result.project).toBe("Not provisioned");
  expect(result.status).toBe("ok");
  expect(result.result.backends.agentMemory.status).toBe("not_applicable");
  expect(result.result.backends.codeReviewGraph.status).toBe("not_applicable");
});

test("doctor in non-git directory returns git repository unavailable warning", async () => {
  const repoDir = await mkdtemp(path.join(tmpdir(), "mega-brain-doc-nongit-"));
  temporaryDirectories.push(repoDir);

  const outputs: string[] = [];
  await main(["doctor", "--repo", repoDir, "--json"], (msg) => outputs.push(msg));

  const jsonStr = outputs.join("\n");
  const result = JSON.parse(jsonStr);

  expect(result.project).toBe("Not provisioned");
  expect(result.status).toBe("degraded");
  expect(result.warnings).toContain("git repository unavailable");
});

test("doctor in provisioned repository runs temporary probes and cleans up", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "mega-brain-doc-data-"));
  const repoDir = await mkdtemp(path.join(tmpdir(), "mega-brain-doc-repo-"));
  temporaryDirectories.push(dataDir, repoDir);
  await execFileAsync("git", ["-C", repoDir, "init"]);

  const identity = await discoverProjectIdentity(repoDir);
  await writeProjectConfig(repoDir, {
    dataDir,
    port: 3000,
    logLevel: "info",
    allowEgress: false,
    allowLlm: false,
    agentMemory: { mode: "managed", baseUrl: "http://127.0.0.1:3111", ports: { rest: 3111, streams: 3112, viewer: 3113, engine: 3114 } },
    codeReviewGraph: { command: "code-review-graph" },
  });

  await installManagedRuntime({
    dataDir,
    identity,
    runner: { run: async () => undefined },
    preflight: false,
    platform: "win32",
    iiiEngine: {
      confirmed: true,
      expectedSha256: sha256Artifact(Buffer.from("dummy-engine-binary")),
      download: async () => Buffer.from("dummy-engine-binary"),
    },
  });

  const outputs: string[] = [];
  await main(["doctor", "--repo", repoDir, "--json"], (msg) => outputs.push(msg));

  const jsonStr = outputs.join("\n");
  const result = JSON.parse(jsonStr);

  expect(result.project).toBe(identity.worktreeId);
  expect(result.result.backends.agentMemory.lifecycle).toBe("temporary probe");
  expect(result.result.backends.codeReviewGraph.lifecycle).toBe("temporary probe");
});
