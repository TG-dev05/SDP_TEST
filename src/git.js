const fs = require('fs/promises');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 1024 * 1024 * 200;

async function runGit(repoPath, args) {
  const { stdout } = await execFileAsync('git', ['-C', repoPath, ...args], { maxBuffer: MAX_BUFFER });
  return stdout;
}

async function cloneRepository(url, destination) {
  await execFileAsync('git', ['clone', url, destination], { maxBuffer: MAX_BUFFER });
}

async function checkoutRepositoryRef(repoPath, ref) {
  if (!ref) return;
  await runGit(repoPath, ['checkout', '--detach', ref]);
}

async function assertGitRepository(repoPath) {
  await fs.access(repoPath);
  const inside = (await runGit(repoPath, ['rev-parse', '--is-inside-work-tree'])).trim();
  if (inside !== 'true') throw new Error('Path is not a Git work tree.');
}

async function listNonMergeCommits(repoPath, ref = 'HEAD') {
  const output = await runGit(repoPath, ['rev-list', '--reverse', '--no-merges', ref]);
  return output.split('\n').map((line) => line.trim()).filter(Boolean);
}

async function getCommitMeta(repoPath, hash) {
  const format = '%H%x00%h%x00%aN%x00%aE%x00%cI%x00%s';
  const output = await runGit(repoPath, ['show', '-s', '--use-mailmap', `--format=${format}`, hash]);
  const [fullHash, shortHash, authorName, authorEmail, date, ...subjectParts] = output.replace(/\n$/, '').split('\u0000');
  const author = `${authorName} <${authorEmail}>`;
  return { hash: fullHash, shortHash, authorName, authorEmail, author, date, subject: subjectParts.join('\u0000') };
}

function parseRenamePath(value) {
  let path = value.trim();
  const brace = path.match(/^(.*)\{(.+) => (.+)\}(.*)$/);
  if (brace) return `${brace[1]}${brace[3]}${brace[4]}`.replace(/\/+/g, '/');
  const arrow = path.match(/^(.+) => (.+)$/);
  if (arrow) return arrow[2].trim();
  return path;
}

async function getCommitNumstat(repoPath, hash) {
  const output = await runGit(repoPath, ['diff-tree', '--root', '-r', '--numstat', '-M50%', '--no-commit-id', hash]);
  return output.split('\n').filter(Boolean).map((line) => {
    const parts = line.split('\t');
    const addedRaw = parts[0];
    const removedRaw = parts[1];
    const filePath = parseRenamePath(parts.slice(2).join('\t'));
    if (addedRaw === '-' || removedRaw === '-') return null;
    return { path: filePath, added: Number(addedRaw) || 0, removed: Number(removedRaw) || 0 };
  }).filter(Boolean);
}

module.exports = { runGit, cloneRepository, checkoutRepositoryRef, assertGitRepository, listNonMergeCommits, getCommitMeta, getCommitNumstat };
