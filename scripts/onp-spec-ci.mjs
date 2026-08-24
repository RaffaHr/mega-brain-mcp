#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const feature = 'mega-brain-mcp-v1';
const spec = await readFile(path.join(root, '.spec', 'features', feature, 'spec.md'), 'utf8');
const tasks = await readFile(path.join(root, '.spec', 'features', feature, 'tasks.md'), 'utf8');
const constitution = await readFile(path.join(root, '.spec', 'constituicao.md'), 'utf8');
const testReport = JSON.stringify(JSON.parse(await readFile(path.join(root, '.spec', 'verification', 'vitest-results.json'), 'utf8')));
const errors = [];

const criteria = [...spec.matchAll(/^#### (AC-\d{3})/gm)].map((match) => match[1]);
for (const criterion of criteria) {
  if (!testReport.includes(`@spec:${criterion}`)) errors.push(`${criterion} has no executed test`);
}
const principles = [...constitution.matchAll(/@principle:(P-\d{3})/g)].map((match) => match[1]);
for (const principle of principles) {
  if (!testReport.includes(`@principle:${principle}`)) errors.push(`${principle} has no executed test`);
}
if (/^## T-\d{3} .*\[(?:pendente|em-andamento)\]/m.test(tasks)) errors.push('tasks are not all concluded');
for (const match of tasks.matchAll(/^- Arquivos: (.+)$/gm)) {
  for (const file of match[1].split(',').map((value) => value.trim())) {
    try { await stat(path.join(root, file)); } catch { errors.push(`declared task file does not exist: ${file}`); }
  }
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`ONP audit: ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`onp-spec audit --ci: ${criteria.length}/${criteria.length} acceptance criteria and ${principles.length}/${principles.length} principles covered\n`);
}
