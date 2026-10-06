const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const REPOS_DIR = path.join(DATA_DIR, 'repos');
const UPLOAD_DIR = path.join(ROOT_DIR, 'uploads');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

module.exports = { ROOT_DIR, DATA_DIR, REPOS_DIR, UPLOAD_DIR, PUBLIC_DIR };
