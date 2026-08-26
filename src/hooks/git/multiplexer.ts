export const MEGA_BRAIN_GIT_HOOKS = ['post-commit', 'post-checkout', 'post-merge', 'post-rewrite'] as const;
export type MegaBrainGitHook = (typeof MEGA_BRAIN_GIT_HOOKS)[number];

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function renderHookMultiplexer(input: {
  event: MegaBrainGitHook;
  previousHook: string;
  megaBrainCommand: string[];
}): string {
  const previous = shellQuote(input.previousHook);
  const command = input.megaBrainCommand.map(shellQuote).join(' ');
  return `#!/bin/sh
previous_status=0
if [ -x ${previous} ]; then
  ${previous} "$@"
  previous_status=$?
fi
( ${command} hook git ${shellQuote(input.event)} "$@" >/dev/null 2>&1 || true ) &
exit "$previous_status"
`;
}
