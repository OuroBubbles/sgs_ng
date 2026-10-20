import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { collectStandardCatalogue } from './standard-catalogue.mjs';
import reviews from './standard-behavior-review.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({
  options: {
    report: { type: 'string', default: '.artifacts/validation/units.json' },
    output: { type: 'string', default: '.artifacts/validation/standard-behavior-audit.json' },
    complete: { type: 'boolean', default: false },
  },
});
const inputs = new Map();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const pathOf = (file) => relative(root, resolve(file)).split(sep).join('/');
function read(file) {
  if (!inputs.has(file)) {
    const bytes = readFileSync(resolve(root, file));
    inputs.set(file, { file, sha256: hash(bytes), text: bytes.toString('utf8') });
  }
  return inputs.get(file).text;
}
function sourceFiles(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(file) : file.endsWith('.ts') ? [file] : [];
  });
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function fresh(file, startedAt) {
  read(file);
  assert(
    statSync(resolve(root, file)).mtimeMs <= startedAt + 2,
    `Source changed after the reported run started: ${file}. Run pnpm test again.`,
  );
}
function save(report) {
  const output = resolve(root, values.output);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}

try {
  const units = JSON.parse(read(values.report));
  assert(
    units.success === true &&
      units.numTotalTests > 0 &&
      units.numPassedTests === units.numTotalTests,
    'A completed, fully passing unit report is required.',
  );
  assert(Number.isFinite(units.startTime), 'The unit report has no run start timestamp.');
  // 只读自有代码；常规检查不依赖 freekill/noname 或上次生成的参考清单。
  for (const directory of ['src/core', 'src/rules', 'src/content/standard'])
    for (const file of sourceFiles(directory)) fresh(file, units.startTime);
  fresh('pnpm-lock.yaml', units.startTime);
  fresh('tsconfig.json', units.startTime);
  const catalogue = collectStandardCatalogue(
    read,
    readdirSync(resolve(root, 'src/content/standard'))
      .filter((name) => name.endsWith('.ts'))
      .sort(),
  );
  const subjects = new Map([
    ...[...catalogue.skills].map(([id, item]) => [id, { ...item, kind: 'skill' }]),
    ...[...catalogue.cards].map(([id, item]) => [
      id,
      { ...item, kind: 'card', name: catalogue.definitions.get(id).name },
    ]),
  ]);
  const files = new Map();
  for (const file of units.testResults) {
    const key = pathOf(file.name);
    assert(!files.has(key), `Duplicate report file: ${key}`);
    files.set(key, file);
  }
  const reviewed = new Set();
  const evidence = new Map();
  const rows = [];
  for (const review of reviews) {
    const subject = subjects.get(review.id);
    assert(
      subject && !reviewed.has(review.id),
      `Unknown or duplicate reviewed subject: ${review.id}`,
    );
    assert(
      subject.description === review.description,
      `Rule text changed; review clauses again: ${review.id}`,
    );
    assert(review.clauses.length > 0, `Review has no clauses: ${review.id}`);
    reviewed.add(review.id);
    const clauseIds = new Set();
    const clauses = review.clauses.map((clause) => {
      assert(
        clause.id && !clauseIds.has(clause.id) && clause.requirement && clause.evidence.length,
        `Empty or duplicate clause: ${review.id}/${clause.id}`,
      );
      clauseIds.add(clause.id);
      const proofs = clause.evidence.map((reference) => {
        assert(
          reference.file.startsWith('tests/scenarios/'),
          `Not a scenario test: ${reference.file}`,
        );
        const file = files.get(reference.file);
        assert(file?.status === 'passed', `Missing/failed report file: ${reference.file}`);
        fresh(reference.file, units.startTime);
        const matches = file.assertionResults.filter(
          (result) => result.fullName === reference.name,
        );
        assert(
          matches.length === 1 && matches[0].status === 'passed',
          `Missing, ambiguous or failed assertion: ${reference.file}: ${reference.name}`,
        );
        const proof = { ...reference, sourceSha256: inputs.get(reference.file).sha256 };
        evidence.set(`${reference.file}\n${reference.name}`, proof);
        return proof;
      });
      return { id: clause.id, requirement: clause.requirement, evidence: proofs };
    });
    rows.push({
      id: review.id,
      name: subject.name,
      kind: subject.kind,
      description: review.description,
      source: subject.source,
      clauses,
    });
  }
  const pending = [...subjects.values()]
    .filter((subject) => !reviewed.has(subject.id))
    .map(({ id, name, kind }) => ({ id, name, kind }));
  // 技能与牌的人工清单分文件维护，两份输入都进入本次证据，不能只记录入口文件。
  const ledgerInputs = [
    'scripts/standard-behavior-review.mjs',
    'scripts/standard-card-review.mjs',
  ].map((file) => {
    read(file);
    return { file, sha256: inputs.get(file).sha256 };
  });
  const report = {
    capturedAt: new Date().toISOString(),
    kind: 'reviewed-standard-clauses',
    status: pending.length ? 'partial' : 'complete',
    catalogueComplete: pending.length === 0,
    fullOfflineVerified: false,
    version: read('src/content/standard/index.ts').match(/version:\s*'([^']+)'/)?.[1],
    report: values.report,
    reportSha256: inputs.get(values.report).sha256,
    ledgerSha256: ledgerInputs[0].sha256,
    ledgerInputs,
    totalSubjects: subjects.size,
    reviewedSubjects: rows.length,
    reviewedClauses: rows.reduce((count, row) => count + row.clauses.length, 0),
    uniqueAssertions: evidence.size,
    reviewed: rows,
    pending,
    inputs: [...inputs.values()]
      .filter((input) => input.file !== values.report)
      .map(({ file, sha256 }) => ({ file, sha256 })),
  };
  save(report);
  console.log(
    `Standard behavior: ${report.reviewedSubjects}/${report.totalSubjects} subjects, ` +
      `${report.reviewedClauses} reviewed clauses, ${report.uniqueAssertions} distinct passing assertions; ${pending.length} pending.`,
  );
  console.log(
    'Only the listed, manually reviewed clauses are checked; this is not full offline acceptance.',
  );
  if (values.complete && pending.length) {
    console.error(
      `Complete catalogue review required; ${pending.length} subjects remain unreviewed.`,
    );
    process.exitCode = 2;
  }
} catch (error) {
  save({
    capturedAt: new Date().toISOString(),
    kind: 'reviewed-standard-clauses',
    status: 'invalid',
    catalogueComplete: false,
    fullOfflineVerified: false,
    error: error.message,
  });
  console.error(error.message);
  process.exitCode = 1;
}
