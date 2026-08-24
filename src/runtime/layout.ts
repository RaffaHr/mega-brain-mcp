import path from 'node:path';

import type { ProjectIdentity } from '../projects/identity.js';

export interface RuntimeLayout {
  projectRoot: string;
  runtimeRoot: string;
  current: string;
  stateFile: string;
  logsDir: string;
}

export function runtimeLayout(dataDir: string, identity: ProjectIdentity): RuntimeLayout {
  const projectRoot = path.resolve(dataDir, 'projects', identity.worktreeId);
  const runtimeRoot = path.join(projectRoot, 'runtime');
  return {
    projectRoot,
    runtimeRoot,
    current: path.join(runtimeRoot, 'current'),
    stateFile: path.join(projectRoot, 'runtime-state.json'),
    logsDir: path.join(projectRoot, 'logs'),
  };
}

export function assertRuntimeChild(layout: RuntimeLayout, candidate: string): string {
  const resolved = path.resolve(candidate);
  const relative = path.relative(layout.runtimeRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') {
    throw new Error('Runtime operation escaped its isolated runtime root');
  }
  return resolved;
}
