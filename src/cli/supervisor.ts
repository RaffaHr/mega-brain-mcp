import type { ProjectIdentity } from '../projects/identity.js';
import { runtimeLayout } from '../runtime/layout.js';
import { startProjectSupervisor, type ProjectSupervisorServer } from '../runtime/project-supervisor.js';

export async function runSupervisorCommand(input: {
  dataDir: string;
  identity: ProjectIdentity;
  onShutdown?: () => Promise<void> | void;
}): Promise<ProjectSupervisorServer> {
  return startProjectSupervisor({
    layout: runtimeLayout(input.dataDir, input.identity),
    identity: input.identity,
    ...(input.onShutdown ? { onShutdown: input.onShutdown } : {}),
  });
}
