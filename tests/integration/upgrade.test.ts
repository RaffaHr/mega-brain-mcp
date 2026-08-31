import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, expect, test } from "vitest";

import { upgradeManagedRuntime } from "../../src/cli/upgrade.js";
import { installManagedRuntime } from "../../src/cli/install.js";
import { upgradeSteps, formatVersionTransition } from "../../src/cli/operation-progress.js";
import { deriveProjectIdentity } from "../../src/projects/identity.js";
import { sha256Artifact } from "../../src/runtime/iii-engine.js";
import { DEFAULT_MANAGED_DEPENDENCY_VERSIONS } from "../../src/runtime/dependency-versions.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];
afterEach(async () => Promise.all(temporaryDirectories.splice(0).map((d) => rm(d, { recursive: true, force: true }))));

test("upgradeManagedRuntime updates version manifest and preserves isolated paths", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "mega-brain-upg-data-"));
  const repoDir = await mkdtemp(path.join(tmpdir(), "mega-brain-upg-repo-"));
  temporaryDirectories.push(dataDir, repoDir);
  await execFileAsync("git", ["-C", repoDir, "init"]);

  const identity = deriveProjectIdentity({ root: repoDir, gitDir: ".git", commonGitDir: ".git" });

  await installManagedRuntime({
    dataDir,
    identity,
    runner: { run: async () => undefined },
    preflight: false,
    platform: "win32",
    iiiEngine: {
      confirmed: true,
      expectedSha256: sha256Artifact(Buffer.from("dummy-binary")),
      download: async () => Buffer.from("dummy-binary"),
    },
    dependencyVersions: {
      agentMemory: "0.9.28",
      codeReviewGraph: "2.3.6",
      iiiEngine: "0.11.1",
    },
  });

  const inspection = await upgradeManagedRuntime({
    dataDir,
    identity,
    agentMemoryMode: "managed",
    pythonCommand: "python",
    preflight: false,
    platform: "win32",
    iiiEngine: {
      confirmed: true,
      expectedSha256: sha256Artifact(Buffer.from("dummy-binary")),
      download: async () => Buffer.from("dummy-binary"),
    },
    dependencyVersions: {
      agentMemory: "0.9.29",
      codeReviewGraph: "2.3.7",
      iiiEngine: "0.11.2",
    },
    runner: { run: async () => undefined },
  });

  expect(inspection.healthy).toBe(true);
  expect(inspection.manifest.versions.agentMemory).toBe("0.9.29");
  expect(inspection.manifest.versions.codeReviewGraph).toBe("2.3.7");
  expect(inspection.manifest.versions.iiiEngine).toBe("0.11.2");
});

test("upgradeSteps displays explicit transitions for upgrades and downgrades", () => {
  const steps = upgradeSteps({
    agentMemoryMode: "managed",
    managedIiiEngineRequired: true,
    managedCodeReviewGraph: true,
    currentVersions: {
      agentMemory: "0.9.28",
      codeReviewGraph: "2.3.8",
      iiiEngine: "0.11.2",
    },
    targetVersions: {
      agentMemory: "0.9.29",
      codeReviewGraph: "2.3.7",
      iiiEngine: "0.11.2",
    },
  });

  const amStep = steps.find((s) => s.id === "agentmemory");
  const crgStep = steps.find((s) => s.id === "crg-package");
  const iiiStep = steps.find((s) => s.id === "iii-engine");

  expect(amStep?.detail).toBe("0.9.28 (current) -> 0.9.29 (latest)");
  expect(crgStep?.detail).toBe("2.3.8 (current) -> 2.3.7 (target, downgrade)");
  expect(iiiStep?.detail).toBe("0.11.2 (current, up-to-date)");
});
