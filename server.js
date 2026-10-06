const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const multer = require('multer');
const AdmZip = require('adm-zip');
const { DATA_DIR, REPOS_DIR, UPLOAD_DIR, PUBLIC_DIR } = require('./src/config');
const store = require('./src/store');
const { cloneRepository, checkoutRepositoryRef, assertGitRepository } = require('./src/git');
const { analyzeRepository, summarizeMetrics } = require('./src/metrics');

const app = express();
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 1024 * 1024 * 1024 } });
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: '5mb' }));
app.use(express.static(PUBLIC_DIR));

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function slugify(value) {
  return String(value || 'repo').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'repo';
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanOptionalRef(ref) {
  const clean = String(ref || '').trim();
  if (!clean) return null;
  if (clean.length > 200 || /[\0\r\n]/.test(clean)) {
    throw new Error('Reference commit or branch is invalid.');
  }
  return clean;
}

async function ensureDirs() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(REPOS_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

async function findGitRoot(dir, depth = 0) {
  const gitPath = path.join(dir, '.git');
  try {
    await fs.access(gitPath);
    return dir;
  } catch (_) {}
  if (depth >= 4) return null;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const found = await findGitRoot(path.join(dir, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

async function analyseAndPersist(repo) {
  if (repo.ref) await checkoutRepositoryRef(repo.path, repo.ref);
  const metrics = await analyzeRepository(repo.path, repo.authorMerges || {});
  await store.writeMetrics(repo.id, metrics);
  const updated = {
    ...repo,
    metricsFile: `metrics-${repo.id}.json`,
    lastAnalyzedAt: new Date().toISOString(),
    lastError: null,
    commitCount: metrics.commits.length,
    authorCount: metrics.authors.length,
  };
  await store.upsertRepo(updated);
  return updated;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'Repo Analysis Tool' });
});

app.get('/api/repositories', asyncHandler(async (req, res) => {
  res.json(await store.listRepos());
}));

app.post('/api/repositories/clone', asyncHandler(async (req, res) => {
  const { url, name } = req.body || {};
  const ref = cleanOptionalRef(req.body?.ref);
  if (!url || !/^https?:\/\/.+|^git@.+|^file:\/\/.+/.test(url)) {
    return res.status(400).json({ error: 'Provide a valid remote Git URL.' });
  }
  const id = createId();
  const repoName = name || url.split('/').pop().replace(/\.git$/, '') || id;
  const repoPath = path.join(REPOS_DIR, `${slugify(repoName)}-${id}`);
  const repo = { id, name: repoName, sourceType: 'clone', source: url, ref, path: repoPath, createdAt: new Date().toISOString(), authorMerges: {} };
  await cloneRepository(url, repoPath);
  await assertGitRepository(repoPath);
  if (ref) await checkoutRepositoryRef(repoPath, ref);
  await store.upsertRepo(repo);
  const analysed = await analyseAndPersist(repo);
  res.status(201).json(analysed);
}));

app.post('/api/repositories/upload', upload.single('repoZip'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a zip file containing a Git repository.' });
  const id = createId();
  const ref = cleanOptionalRef(req.body?.ref);
  const repoName = req.body.name || req.file.originalname.replace(/\.zip$/i, '') || id;
  const extractDir = path.join(REPOS_DIR, `${slugify(repoName)}-${id}`);
  await fs.mkdir(extractDir, { recursive: true });
  const zip = new AdmZip(req.file.path);
  zip.extractAllTo(extractDir, true);
  await fs.unlink(req.file.path).catch(() => {});
  const gitRoot = await findGitRoot(extractDir);
  if (!gitRoot) return res.status(400).json({ error: 'The zip file did not contain a .git directory or file.' });
  await assertGitRepository(gitRoot);
  const repo = { id, name: repoName, sourceType: 'zip', source: req.file.originalname, ref, path: gitRoot, createdAt: new Date().toISOString(), authorMerges: {} };
  if (ref) await checkoutRepositoryRef(gitRoot, ref);
  await store.upsertRepo(repo);
  const analysed = await analyseAndPersist(repo);
  res.status(201).json(analysed);
}));

app.post('/api/repositories/:id/reanalyse', asyncHandler(async (req, res) => {
  const repo = await store.getRepo(req.params.id);
  if (!repo) return res.status(404).json({ error: 'Repository not found.' });
  res.json(await analyseAndPersist(repo));
}));

app.get('/api/repositories/:id/commits', asyncHandler(async (req, res) => {
  const repo = await store.getRepo(req.params.id);
  if (!repo) return res.status(404).json({ error: 'Repository not found.' });
  const metrics = await store.readMetrics(repo.id);
  res.json(metrics.commits.map(({ hash, shortHash, date, author, subject }) => ({ hash, shortHash, date, author, subject })));
}));

app.get('/api/repositories/:id/metrics', asyncHandler(async (req, res) => {
  const repo = await store.getRepo(req.params.id);
  if (!repo) return res.status(404).json({ error: 'Repository not found.' });
  const metrics = await store.readMetrics(repo.id);
  const summary = summarizeMetrics(metrics, {
    start: req.query.start,
    end: req.query.end,
    commits: req.query.commits,
    author: req.query.author,
    path: req.query.path,
    type: req.query.type,
  });
  res.json({ repository: repo, ...summary });
}));

app.post('/api/repositories/:id/authors/merge', asyncHandler(async (req, res) => {
  const repo = await store.getRepo(req.params.id);
  if (!repo) return res.status(404).json({ error: 'Repository not found.' });
  const canonical = String(req.body?.canonical || '').trim();
  const aliases = Array.isArray(req.body?.aliases) ? req.body.aliases.map(String) : [];
  if (!canonical || aliases.length === 0) return res.status(400).json({ error: 'Provide canonical and aliases.' });
  const authorMerges = { ...(repo.authorMerges || {}) };
  for (const alias of aliases) {
    const clean = alias.trim();
    if (clean && clean !== canonical) authorMerges[clean] = canonical;
  }
  const updated = { ...repo, authorMerges };
  await store.upsertRepo(updated);
  res.json(await analyseAndPersist(updated));
}));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Unexpected server error.' });
});

function listenWithPortFallback(port, attemptsLeft = 10) {
  const server = app.listen(port, () => {
    console.log(`RAT dashboard running on http://localhost:${port}`);
    if (port !== PORT) {
      console.log(`Port ${PORT} was busy, so the app used port ${port} instead.`);
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`Port ${port} is already in use. Trying port ${port + 1}...`);
      listenWithPortFallback(port + 1, attemptsLeft - 1);
      return;
    }
    console.error('Unable to start server:', err.message || err);
    process.exit(1);
  });
}

ensureDirs().then(() => {
  listenWithPortFallback(PORT);
}).catch((err) => {
  console.error('Unable to start server:', err);
  process.exit(1);
});
