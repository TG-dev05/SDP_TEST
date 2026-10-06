const path = require('path');
const fs = require('fs/promises');
const { DATA_DIR } = require('./config');

const DB_FILE = path.join(DATA_DIR, 'db.json');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

async function loadDb() {
  return readJson(DB_FILE, { repositories: [] });
}

async function saveDb(db) {
  await writeJson(DB_FILE, db);
}

async function listRepos() {
  const db = await loadDb();
  return db.repositories.map(({ path: _path, ...repo }) => repo);
}

async function getRepo(id) {
  const db = await loadDb();
  return db.repositories.find((repo) => repo.id === id) || null;
}

async function upsertRepo(repo) {
  const db = await loadDb();
  const index = db.repositories.findIndex((item) => item.id === repo.id);
  if (index >= 0) db.repositories[index] = repo;
  else db.repositories.push(repo);
  await saveDb(db);
  return repo;
}

function metricsPath(id) {
  return path.join(DATA_DIR, `metrics-${id}.json`);
}

async function writeMetrics(id, metrics) {
  await writeJson(metricsPath(id), metrics);
}

async function readMetrics(id) {
  return readJson(metricsPath(id), null);
}

module.exports = { listRepos, getRepo, upsertRepo, writeMetrics, readMetrics };
