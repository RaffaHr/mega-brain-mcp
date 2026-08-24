import { realpath } from 'node:fs/promises';
import path from 'node:path';

import type { ProjectIdentity } from './identity.js';

const ALIAS = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export interface RegisteredProject {
  alias: string;
  identity: ProjectIdentity;
}

export class ProjectRegistry {
  readonly #projects = new Map<string, ProjectIdentity>();

  constructor(projects: Iterable<RegisteredProject> = []) {
    for (const project of projects) this.register(project.alias, project.identity);
  }

  register(alias: string, identity: ProjectIdentity): void {
    if (!ALIAS.test(alias)) throw new Error(`Invalid project alias: ${alias}`);
    const current = this.#projects.get(alias);
    if (current && current.worktreeId !== identity.worktreeId) {
      throw new Error(`Project alias already belongs to another worktree: ${alias}`);
    }
    this.#projects.set(alias, identity);
  }

  resolve(alias: string): ProjectIdentity {
    const project = this.#projects.get(alias);
    if (!project) throw new Error(`Project is not registered: ${alias}`);
    return project;
  }

  list(): RegisteredProject[] {
    return [...this.#projects.entries()]
      .map(([alias, identity]) => ({ alias, identity }))
      .sort((left, right) => left.alias.localeCompare(right.alias));
  }
}

export async function assertPathWithinProject(identity: ProjectIdentity, candidate: string): Promise<string> {
  const resolved = await realpath(candidate);
  const relative = path.relative(identity.root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path is outside the registered project root');
  }
  return resolved;
}
