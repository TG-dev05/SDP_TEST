const path = require('path');
const { listNonMergeCommits, getCommitMeta, getCommitNumstat } = require('./git');

function normalizeObjectPath(value) {
  if (!value || value === '.') return '/';
  return String(value).replace(/^\/+|\/+$/g, '') || '/';
}

function parentDirectories(filePath) {
  const clean = normalizeObjectPath(filePath);
  if (clean === '/') return ['/'];
  const parts = clean.split('/');
  const dirs = ['/'];
  for (let i = 1; i < parts.length; i += 1) dirs.push(parts.slice(0, i).join('/'));
  return dirs;
}

function addMetric(target, key, added, removed) {
  if (!target[key]) target[key] = { added: 0, removed: 0, growth: 0, churn: 0 };
  target[key].added += added;
  target[key].removed += removed;
  target[key].growth += added - removed;
  target[key].churn += added + removed;
}

function canonicalAuthor(author, merges) {
  return merges?.[author] || author;
}

async function analyzeRepository(repoPath, authorMerges = {}) {
  const hashes = await listNonMergeCommits(repoPath);
  const commits = [];
  const authors = new Set();
  const files = new Set();
  const dirs = new Set(['/']);

  for (const hash of hashes) {
    const meta = await getCommitMeta(repoPath, hash);
    const author = canonicalAuthor(meta.author, authorMerges);
    authors.add(author);
    const rows = await getCommitNumstat(repoPath, hash);
    const fileMetrics = {};
    const dirMetrics = {};

    for (const row of rows) {
      const filePath = normalizeObjectPath(row.path);
      files.add(filePath);
      addMetric(fileMetrics, filePath, row.added, row.removed);
      for (const dir of parentDirectories(filePath)) {
        dirs.add(dir);
        addMetric(dirMetrics, dir, row.added, row.removed);
      }
    }

    commits.push({
      hash: meta.hash,
      shortHash: meta.shortHash,
      subject: meta.subject,
      date: meta.date,
      timestamp: Math.floor(new Date(meta.date).getTime() / 1000),
      author,
      files: fileMetrics,
      dirs: dirMetrics,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    authors: [...authors].sort(),
    files: [...files].sort(),
    dirs: [...dirs].sort((a, b) => a.localeCompare(b)),
    commits,
  };
}

function parseTimestamp(value, boundary) {
  if (!value) return null;
  if (/^\d+$/.test(String(value))) return Number(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (boundary === 'end' && /^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCHours(23, 59, 59, 999);
  return Math.floor(date.getTime() / 1000);
}

function parseCommitSet(value) {
  if (!value) return null;
  const ids = String(value).split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

function matchesCommit(commit, commitSet) {
  if (!commitSet) return true;
  return commitSet.has(commit.hash) || commitSet.has(commit.shortHash);
}

function isPathMatch(objectPath, filterPath, objectType) {
  if (!filterPath) return true;
  const clean = normalizeObjectPath(filterPath);
  if (clean === '/') return true;
  if (objectPath === clean) return true;
  return objectPath.startsWith(`${clean}/`);
}

function updateAggregate(bucket, commit, objectType, objectPath, metric) {
  const id = `${objectType}:${objectPath}`;
  if (!bucket[id]) {
    bucket[id] = { type: objectType, path: objectPath, added: 0, removed: 0, growth: 0, churn: 0, modifications: 0, authors: {} };
  }
  const target = bucket[id];
  target.added += metric.added;
  target.removed += metric.removed;
  target.growth += metric.growth;
  target.churn += metric.churn;
  if (metric.churn > 0) target.modifications += 1;
  if (!target.authors[commit.author]) {
    target.authors[commit.author] = { added: 0, removed: 0, growth: 0, modifications: 0, churn: 0, ownership: 0 };
  }
  target.authors[commit.author].added += metric.added;
  target.authors[commit.author].removed += metric.removed;
  target.authors[commit.author].growth += metric.growth;
  if (metric.churn > 0) target.authors[commit.author].modifications += 1;
  target.authors[commit.author].churn += metric.churn;
}

function finalizeObjectMetrics(bucket, commitCount) {
  return Object.values(bucket).map((item) => {
    const authors = Object.entries(item.authors).map(([author, stats]) => ({
      author,
      added: stats.added,
      removed: stats.removed,
      growth: stats.growth,
      modifications: stats.modifications,
      churn: stats.churn,
      ownership: item.churn === 0 ? 0 : stats.churn / item.churn,
    })).sort((a, b) => b.churn - a.churn || a.author.localeCompare(b.author));
    return {
      ...item,
      authors,
      modificationFrequency: commitCount === 0 ? 0 : item.modifications / commitCount,
      churnRate: commitCount === 0 ? 0 : item.churn / commitCount,
    };
  }).sort((a, b) => b.churn - a.churn || a.path.localeCompare(b.path));
}

function summarizeMetrics(metrics, filters = {}) {
  const start = parseTimestamp(filters.start, 'start');
  const end = parseTimestamp(filters.end, 'end');
  const commitSet = parseCommitSet(filters.commits);
  const authorFilter = filters.author ? String(filters.author) : null;
  const pathFilter = filters.path ? normalizeObjectPath(filters.path) : null;
  const typeFilter = filters.type && filters.type !== 'all' ? filters.type : null;

  const selectedCommits = metrics.commits.filter((commit) => {
    if (start !== null && commit.timestamp < start) return false;
    if (end !== null && commit.timestamp >= end) return false;
    if (!matchesCommit(commit, commitSet)) return false;
    if (authorFilter && commit.author !== authorFilter) return false;
    return true;
  });

  const aggregate = {};
  for (const commit of selectedCommits) {
    if (!typeFilter || typeFilter === 'file') {
      for (const [objectPath, metric] of Object.entries(commit.files)) {
        if (isPathMatch(objectPath, pathFilter, 'file')) updateAggregate(aggregate, commit, 'file', objectPath, metric);
      }
    }
    if (!typeFilter || typeFilter === 'directory') {
      for (const [objectPath, metric] of Object.entries(commit.dirs)) {
        if (isPathMatch(objectPath, pathFilter, 'directory')) updateAggregate(aggregate, commit, 'directory', objectPath, metric);
      }
    }
  }

  const objects = finalizeObjectMetrics(aggregate, selectedCommits.length);
  const repo = objects.find((item) => item.type === 'directory' && item.path === '/') || { type: 'directory', path: '/', added: 0, removed: 0, growth: 0, churn: 0, modifications: 0, modificationFrequency: 0, churnRate: 0, authors: [] };
  const authorTotals = {};
  for (const object of objects) {
    for (const author of object.authors) {
      if (!authorTotals[author.author]) {
        authorTotals[author.author] = { author: author.author, added: 0, removed: 0, growth: 0, modifications: 0, churn: 0 };
      }
      authorTotals[author.author].added += author.added;
      authorTotals[author.author].removed += author.removed;
      authorTotals[author.author].growth += author.growth;
      authorTotals[author.author].modifications += author.modifications;
      authorTotals[author.author].churn += author.churn;
    }
  }

  return {
    generatedAt: metrics.generatedAt,
    filters: { start, end, author: authorFilter, path: pathFilter, type: typeFilter, commitCount: selectedCommits.length },
    authors: metrics.authors,
    knownPaths: { files: metrics.files, directories: metrics.dirs },
    commits: selectedCommits.map(({ files, dirs, ...commit }) => commit),
    repositoryMetrics: repo,
    objects,
    authorTotals: Object.values(authorTotals).sort((a, b) => b.churn - a.churn || a.author.localeCompare(b.author)),
  };
}

module.exports = { analyzeRepository, summarizeMetrics, normalizeObjectPath };
