#!/usr/bin/env node
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const featuresRoot = path.join(root, '.spec', 'features');
const featureNames = (await readdir(featuresRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const constitution = await readFile(path.join(root, '.spec', 'constituicao.md'), 'utf8');
const testReport = JSON.stringify(JSON.parse(await readFile(path.join(root, '.spec', 'verification', 'vitest-results.json'), 'utf8')));
const errors = [];
const criteria = [];

for (const feature of featureNames) {
  const featureRoot = path.join(featuresRoot, feature);
  const spec = await readFile(path.join(featureRoot, 'spec.md'), 'utf8');
  const tasks = await readFile(path.join(featureRoot, 'tasks.md'), 'utf8');
  const featureCriteria = [...spec.matchAll(/^#### (AC-\d{3})/gm)].map((match) => match[1]);
  criteria.push(...featureCriteria);

  for (const criterion of featureCriteria) {
    if (!testReport.includes(`@spec:${criterion}`)) errors.push(`${feature}: ${criterion} has no executed test`);
  }
  if (/^## T-\d{3} .*\[(?:pendente|em-andamento)\]/m.test(tasks)) {
    errors.push(`${feature}: tasks are not all concluded`);
  }
  for (const match of tasks.matchAll(/^- Arquivos: (.+)$/gm)) {
    for (const file of match[1].split(',').map((value) => value.trim())) {
      try {
        await stat(path.join(root, file));
      } catch {
        errors.push(`${feature}: declared task file does not exist: ${file}`);
      }
    }
  }
}

const uniqueCriteria = new Set(criteria);
if (uniqueCriteria.size !== criteria.length) errors.push('acceptance criterion IDs are duplicated across features');

const principles = [...new Set([...constitution.matchAll(/@principle:(P-\d{3})/g)].map((match) => match[1]))];
for (const principle of principles) {
  if (!testReport.includes(`@principle:${principle}`)) errors.push(`${principle} has no executed test`);
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`ONP audit: ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `onp-spec audit --ci: ${featureNames.length} features, ${criteria.length}/${criteria.length} acceptance criteria and ${principles.length}/${principles.length} principles covered\n`,
  );
}
