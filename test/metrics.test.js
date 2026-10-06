const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { analyzeRepository, summarizeMetrics } = require('../src/metrics');

const execFileAsync = promisify(execFile);

async function git(repo, args, env = {}) {
  await execFileAsync('git', ['-C', repo, ...args], {
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024 * 20,
  });
}

async function write(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function createFixtureRepo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rat-metrics-'));
  const repo = path.join(root, 'repo');
  await fs.mkdir(repo);
  await execFileAsync('git', ['init', repo]);
  await git(repo, ['config', 'user.name', 'Alice']);
  await git(repo, ['config', 'user.email', 'alice@example.com']);

  await write(path.join(repo, 'src', 'app.js'), 'one\ntwo\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'initial'], {
    GIT_AUTHOR_NAME: 'Alice',
    GIT_AUTHOR_EMAIL: 'alice@example.com',
    GIT_COMMITTER_NAME: 'Alice',
    GIT_COMMITTER_EMAIL: 'alice@example.com',
    GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z',
  });

  await write(path.join(repo, 'src', 'app.js'), 'one\ntwo\nthree\n');
  await write(path.join(repo, 'README.md'), 'hello\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'grow app'], {
    GIT_AUTHOR_NAME: 'Bob',
    GIT_AUTHOR_EMAIL: 'bob@example.com',
    GIT_COMMITTER_NAME: 'Bob',
    GIT_COMMITTER_EMAIL: 'bob@example.com',
    GIT_AUTHOR_DATE: '2020-01-02T00:00:00Z',
    GIT_COMMITTER_DATE: '2020-01-02T00:00:00Z',
  });

  await write(path.join(repo, 'src', 'app.js'), 'one\nthree\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'remove line'], {
    GIT_AUTHOR_NAME: 'Robert',
    GIT_AUTHOR_EMAIL: 'rob@example.com',
    GIT_COMMITTER_NAME: 'Robert',
    GIT_COMMITTER_EMAIL: 'rob@example.com',
    GIT_AUTHOR_DATE: '2020-01-03T00:00:00Z',
    GIT_COMMITTER_DATE: '2020-01-03T00:00:00Z',
  });

  return repo;
}

test('computes file, directory, repository, commit-set, and author metrics', async () => {
  const repo = await createFixtureRepo();
  const metrics = await analyzeRepository(repo, { 'Robert <rob@example.com>': 'Bob <bob@example.com>' });
  const summary = summarizeMetrics(metrics, {});

  assert.equal(metrics.commits.length, 3);
  assert.deepEqual(metrics.authors, ['Alice <alice@example.com>', 'Bob <bob@example.com>']);

  const repoMetrics = summary.repositoryMetrics;
  assert.equal(repoMetrics.added, 4);
  assert.equal(repoMetrics.removed, 1);
  assert.equal(repoMetrics.growth, 3);
  assert.equal(repoMetrics.churn, 5);
  assert.equal(repoMetrics.modifications, 3);
  assert.equal(repoMetrics.modificationFrequency, 1);

  const appFile = summary.objects.find((item) => item.type === 'file' && item.path === 'src/app.js');
  assert.equal(appFile.added, 3);
  assert.equal(appFile.removed, 1);
  assert.equal(appFile.growth, 2);
  assert.equal(appFile.churn, 4);
  assert.equal(appFile.modifications, 3);

  const srcDir = summary.objects.find((item) => item.type === 'directory' && item.path === 'src');
  assert.equal(srcDir.churn, 4);

  const bobOwnership = appFile.authors.find((author) => author.author === 'Bob <bob@example.com>');
  assert.equal(bobOwnership.added, 1);
  assert.equal(bobOwnership.removed, 1);
  assert.equal(bobOwnership.growth, 0);
  assert.equal(bobOwnership.modifications, 2);
  assert.equal(bobOwnership.churn, 2);
  assert.equal(bobOwnership.ownership, 0.5);
});

test('filters by author, path, date range, object type, and manual commit set', async () => {
  const repo = await createFixtureRepo();
  const metrics = await analyzeRepository(repo, { 'Robert <rob@example.com>': 'Bob <bob@example.com>' });
  const bobSummary = summarizeMetrics(metrics, { author: 'Bob <bob@example.com>', path: 'src', type: 'file' });

  assert.equal(bobSummary.filters.commitCount, 2);
  assert.equal(bobSummary.objects.length, 1);
  assert.equal(bobSummary.objects[0].path, 'src/app.js');
  assert.equal(bobSummary.objects[0].churn, 2);

  const secondCommit = metrics.commits[1];
  const commitSummary = summarizeMetrics(metrics, { commits: secondCommit.shortHash });
  assert.equal(commitSummary.filters.commitCount, 1);
  assert.equal(commitSummary.repositoryMetrics.added, 2);
  assert.equal(commitSummary.repositoryMetrics.removed, 0);

  const afterFirst = summarizeMetrics(metrics, { start: metrics.commits[1].timestamp });
  assert.equal(afterFirst.filters.commitCount, 2);
});
