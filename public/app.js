const state = { repositories: [], metrics: null };
const $ = (id) => document.getElementById(id);

function setStatus(message, isError = false) {
  const el = $('status');
  el.textContent = message;
  el.className = `status ${isError ? 'error' : ''}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body.error || body || `HTTP ${response.status}`);
  return body;
}

function fmt(value, digits = 2) {
  if (typeof value !== 'number') return value ?? '';
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(digits);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

const PIE_COLORS = ['#2563eb', '#0f766e', '#f97316', '#7c3aed', '#db2777', '#0891b2', '#94a3b8'];

function selectedRepoId() {
  return $('repoSelect').value;
}

async function loadRepositories() {
  state.repositories = await api('/api/repositories');
  const select = $('repoSelect');
  const previous = select.value;
  select.innerHTML = state.repositories.map((repo) => `<option value="${repo.id}">${repo.name} (${repo.commitCount || 0} commits)</option>`).join('');
  if (previous && state.repositories.some((repo) => repo.id === previous)) select.value = previous;
  if (select.value) await loadMetrics();
}

function queryString() {
  const params = new URLSearchParams();
  const author = $('authorFilter').value;
  const type = $('typeFilter').value;
  const path = $('pathFilter').value.trim();
  const start = $('startFilter').value;
  const end = $('endFilter').value;
  const commits = $('commitFilter').value.trim();
  if (author) params.set('author', author);
  if (type) params.set('type', type);
  if (path) params.set('path', path);
  if (start) params.set('start', start);
  if (end) params.set('end', end);
  if (commits) params.set('commits', commits);
  return params.toString();
}

async function loadMetrics() {
  const repoId = selectedRepoId();
  if (!repoId) return;
  setStatus('Loading metrics...');
  state.metrics = await api(`/api/repositories/${repoId}/metrics?${queryString()}`);
  renderMetrics();
  setStatus('Ready');
}

function renderOptions() {
  const authors = state.metrics.authors || [];
  const current = $('authorFilter').value;
  $('authorFilter').innerHTML = '<option value="">All authors</option>' + authors.map((author) => `<option value="${author}">${author}</option>`).join('');
  if (authors.includes(current)) $('authorFilter').value = current;
  $('canonicalAuthor').innerHTML = authors.map((author) => `<option value="${author}">${author}</option>`).join('');
  $('aliasAuthors').innerHTML = authors.map((author) => `<option value="${author}">${author}</option>`).join('');
  const paths = [...(state.metrics.knownPaths?.directories || []), ...(state.metrics.knownPaths?.files || [])];
  $('pathOptions').innerHTML = paths.map((p) => `<option value="${p}"></option>`).join('');
}

function renderSummary() {
  const repo = state.metrics.repositoryMetrics;
  const cards = [
    ['Selected commits', state.metrics.filters.commitCount, 'Commits in the current filter', ''],
    ['Repository added', repo.added, 'Lines added', 'added'],
    ['Repository removed', repo.removed, 'Lines removed', 'removed'],
    ['Repository growth', repo.growth, 'Added minus removed', ''],
    ['Repository churn', repo.churn, 'Added plus removed', 'churn'],
    ['Mod frequency', fmt(repo.modificationFrequency), 'Modified commits / selected commits', ''],
  ];
  $('summaryCards').innerHTML = cards.map(([label, value, helper, tone]) => `<article class="${tone}"><span>${label}</span><strong>${fmt(value)}</strong><small>${helper}</small></article>`).join('');
}

function renderChart() {
  const top = state.metrics.objects.slice(0, 10);
  const max = Math.max(1, ...top.map((item) => item.churn));
  const rows = top.map((item) => {
    const width = Math.max(3, (item.churn / max) * 100);
    return `<div class="barRow"><span title="${item.path}">${item.path}</span><div class="track"><b style="width:${width}%"></b></div><em>${fmt(item.churn)}</em><i class="typePill">${item.type}</i></div>`;
  }).join('');
  $('chart').innerHTML = `<div class="chartHeader"><div><h3>Top churn hotspots</h3><p>Churn is added lines plus removed lines. Larger bars indicate more volatile files or folders.</p></div><span class="typePill">Top ${top.length}</span></div>${rows || '<p class="muted">No changed objects in this selection.</p>'}`;
}

function renderAuthorPieChart() {
  const authors = (state.metrics.authorTotals || []).filter((author) => author.churn > 0);
  if (!authors.length) {
    $('authorPieChart').innerHTML = '<div class="chartHeader"><div><h3>Author churn share</h3><p>No author churn in the current selection.</p></div></div>';
    return;
  }

  const total = authors.reduce((sum, author) => sum + author.churn, 0);
  const topAuthors = authors.slice(0, 6);
  const topTotal = topAuthors.reduce((sum, author) => sum + author.churn, 0);
  const chartRows = topTotal < total ? [...topAuthors, { author: 'Other authors', churn: total - topTotal }] : topAuthors;
  let cursor = 0;
  const segments = chartRows.map((author, index) => {
    const start = cursor;
    const end = cursor + (author.churn / total) * 360;
    cursor = end;
    return `${PIE_COLORS[index % PIE_COLORS.length]} ${start}deg ${end}deg`;
  });
  const legend = chartRows.map((author, index) => {
    const percent = total === 0 ? 0 : (author.churn / total) * 100;
    const safeAuthor = escapeHtml(author.author);
    return `<div class="pieLegendRow"><span class="pieSwatch" style="background:${PIE_COLORS[index % PIE_COLORS.length]}"></span><div><strong title="${safeAuthor}">${safeAuthor}</strong><small>${fmt(author.churn)} churn · ${fmt(percent, 1)}%</small></div></div>`;
  }).join('');

  $('authorPieChart').innerHTML = `
    <div class="chartHeader">
      <div><h3>Author churn share</h3><p>Shows which authors contributed the largest share of changed lines in the current filter.</p></div>
      <span class="typePill">${fmt(total)} churn</span>
    </div>
    <div class="pieLayout">
      <div class="pieDonut" style="background: conic-gradient(${segments.join(', ')})"><span>${chartRows.length}<small>authors</small></span></div>
      <div class="pieLegend">${legend}</div>
    </div>`;
}

function renderTable() {
  const rows = state.metrics.objects.slice(0, 250).map((item) => {
    const owner = item.authors[0];
    const ownerText = owner ? `${owner.author} (${fmt(owner.ownership * 100, 1)}%)` : '';
    return `<tr><td>${item.type}</td><td title="${item.path}">${item.path}</td><td>${fmt(item.added)}</td><td>${fmt(item.removed)}</td><td>${fmt(item.growth)}</td><td>${fmt(item.churn)}</td><td>${fmt(item.modifications)}</td><td>${fmt(item.modificationFrequency)}</td><td>${fmt(item.churnRate)}</td><td>${ownerText}</td></tr>`;
  }).join('');
  $('metricsTable').querySelector('tbody').innerHTML = rows || '<tr><td colspan="10">No metrics match the current filters.</td></tr>';
}

function renderAuthorTotals() {
  const max = Math.max(1, ...state.metrics.authorTotals.map((author) => author.churn));
  $('authorTotals').innerHTML = state.metrics.authorTotals.map((author) => {
    const width = Math.max(3, (author.churn / max) * 100);
    return `<div class="authorLine"><span>${author.author}</span><strong>${fmt(author.churn)} churn</strong><div class="authorTrack"><b style="width:${width}%"></b></div><small>${fmt(author.added)} added · ${fmt(author.removed)} removed · ${fmt(author.modifications)} modifications</small></div>`;
  }).join('') || '<p class="muted">No author activity in this selection.</p>';
}

function renderMetrics() {
  renderOptions();
  renderSummary();
  renderChart();
  renderAuthorPieChart();
  renderTable();
  renderAuthorTotals();
}

$('cloneForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setStatus('Cloning and analysing repository...');
    await api('/api/repositories/clone', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: $('cloneUrl').value, name: $('cloneName').value, ref: $('cloneRef').value }) });
    event.target.reset();
    await loadRepositories();
  } catch (err) { setStatus(err.message, true); }
});

$('uploadForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    setStatus('Uploading and analysing repository...');
    const formData = new FormData(event.target);
    await api('/api/repositories/upload', { method: 'POST', body: formData });
    event.target.reset();
    await loadRepositories();
  } catch (err) { setStatus(err.message, true); }
});

$('mergeForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const aliases = [...$('aliasAuthors').selectedOptions].map((option) => option.value);
    setStatus('Merging authors and reanalysing...');
    await api(`/api/repositories/${selectedRepoId()}/authors/merge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ canonical: $('canonicalAuthor').value, aliases }) });
    await loadMetrics();
  } catch (err) { setStatus(err.message, true); }
});

$('refreshRepos').addEventListener('click', () => loadRepositories().catch((err) => setStatus(err.message, true)));
$('repoSelect').addEventListener('change', () => loadMetrics().catch((err) => setStatus(err.message, true)));
$('applyFilters').addEventListener('click', () => loadMetrics().catch((err) => setStatus(err.message, true)));
$('reanalyze').addEventListener('click', async () => {
  try {
    setStatus('Reanalysing repository...');
    await api(`/api/repositories/${selectedRepoId()}/reanalyse`, { method: 'POST' });
    await loadRepositories();
  } catch (err) { setStatus(err.message, true); }
});

const tourSteps = [
  {
    selector: '#addRepoCard',
    title: 'Add a repository first',
    text: 'Start here when you want to analyse a project. You can either clone a Git repository from a URL or upload a zip file that contains a .git folder.',
    tip: 'For a quick test, try a small public URL like https://github.com/DaveGamble/cJSON.git',
  },
  {
    selector: '#cloneForm',
    title: 'Clone using a repository link',
    text: 'Paste a Git URL into Remote URL, optionally give it a friendly name, and click Clone and analyse. The app downloads the repository and computes the metrics automatically.',
    tip: 'Use the reference field only when you need results for a specific commit or branch.',
  },
  {
    selector: '#uploadForm',
    title: 'Upload a zipped repository',
    text: 'Use this when you already have a zip file. The zip must contain the repository’s .git folder or .git file so the app can read its history.',
    tip: 'A zip containing only CSVs or source files without .git will be rejected.',
  },
  {
    selector: '#filtersPanel',
    title: 'Filter what you are looking at',
    text: 'After analysis, narrow the results by repository, author, files, directories, date range, path, or a manual list of commit hashes.',
    tip: 'After changing filters, click Apply filters to refresh the dashboard.',
  },
  {
    selector: '#summaryCards',
    title: 'Read the headline numbers',
    text: 'These cards summarize the selected commits. Added means new lines, removed means deleted lines, growth is added minus removed, and churn is added plus removed.',
    tip: 'High churn usually means that part of the project changed often or changed heavily.',
  },
  {
    selector: '#chart',
    title: 'Find churn hotspots',
    text: 'This chart shows the files and folders with the highest churn. The longest bars are the most volatile areas in the current filter.',
    tip: 'Use this to quickly find files or directories that may need attention.',
  },
  {
    selector: '#authorPieChart',
    title: 'Compare author share visually',
    text: 'This donut chart shows each author’s share of churn in the current filter, so you can quickly see who made the largest portion of changes.',
    tip: 'Change the path, author, date, or commit filters and this chart updates with the rest of the dashboard.',
  },
  {
    selector: '#objectMetricsCard',
    title: 'Inspect detailed object metrics',
    text: 'The table gives exact metrics for each file or directory, including added lines, removed lines, growth, churn, modification count, frequency, churn rate, and top owner.',
    tip: 'If you filter by a path such as src, this table focuses on that area.',
  },
  {
    selector: '#authorTotalsCard',
    title: 'Understand author activity',
    text: 'Author totals show who contributed the most churn in the selected view. The mini bars make it easier to compare authors at a glance.',
    tip: 'Combine this with the author filter to focus on one developer.',
  },
  {
    selector: '#authorMergeCard',
    title: 'Merge duplicate authors',
    text: 'Sometimes one person appears under multiple names or emails. Choose the name to keep, select the aliases, then merge them and reanalyse.',
    tip: 'The app also applies .mailmap automatically when a repository provides one.',
  },
];

let currentTourStep = 0;
let previousFocusedElement = null;

function getTourElements() {
  return {
    overlay: $('tourOverlay'),
    spotlight: $('tourSpotlight'),
    panel: $('tourPanel'),
    title: $('tourTitle'),
    text: $('tourText'),
    tip: $('tourTip'),
    counter: $('tourStepCounter'),
    back: $('tourBack'),
    next: $('tourNext'),
  };
}

function clearTourTarget() {
  document.querySelectorAll('.tourTargetActive').forEach((el) => el.classList.remove('tourTargetActive'));
}

function positionTourStep() {
  const elements = getTourElements();
  const step = tourSteps[currentTourStep];
  const target = document.querySelector(step.selector);
  if (!target) return;

  target.classList.add('tourTargetActive');
  const rect = target.getBoundingClientRect();
  const padding = 12;
  elements.spotlight.style.left = `${Math.max(8, rect.left - padding)}px`;
  elements.spotlight.style.top = `${Math.max(8, rect.top - padding)}px`;
  elements.spotlight.style.width = `${Math.min(window.innerWidth - 16, rect.width + padding * 2)}px`;
  elements.spotlight.style.height = `${Math.min(window.innerHeight - 16, rect.height + padding * 2)}px`;

  const panelWidth = Math.min(420, window.innerWidth - 32);
  let left = rect.right + 24;
  if (left + panelWidth > window.innerWidth - 16) left = rect.left - panelWidth - 24;
  if (left < 16) left = Math.min(16, window.innerWidth - panelWidth - 16);

  let top = rect.top;
  const panelHeight = elements.panel.offsetHeight || 280;
  if (top + panelHeight > window.innerHeight - 16) top = window.innerHeight - panelHeight - 16;
  if (top < 16) top = 16;

  elements.panel.style.left = `${left}px`;
  elements.panel.style.top = `${top}px`;
  elements.panel.style.width = `${panelWidth}px`;
}

function showTourStep(index) {
  const elements = getTourElements();
  currentTourStep = Math.max(0, Math.min(index, tourSteps.length - 1));
  const step = tourSteps[currentTourStep];
  const target = document.querySelector(step.selector);

  clearTourTarget();
  elements.title.textContent = step.title;
  elements.text.textContent = step.text;
  elements.tip.textContent = step.tip;
  elements.counter.textContent = `Step ${currentTourStep + 1} of ${tourSteps.length}`;
  elements.back.disabled = currentTourStep === 0;
  elements.next.textContent = currentTourStep === tourSteps.length - 1 ? 'Finish' : 'Next';

  if (target) {
    target.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    window.requestAnimationFrame(() => window.requestAnimationFrame(positionTourStep));
  } else {
    positionTourStep();
  }
}

function openTour() {
  previousFocusedElement = document.activeElement;
  const elements = getTourElements();
  elements.overlay.hidden = false;
  elements.overlay.removeAttribute('hidden');
  elements.overlay.style.visibility = 'visible';
  document.body.classList.add('tourOpen');
  showTourStep(0);
  elements.next.focus();
}

function closeTour(saveSeen = true) {
  const elements = getTourElements();
  elements.overlay.hidden = true;
  elements.overlay.setAttribute('hidden', '');
  elements.overlay.style.visibility = '';
  document.body.classList.remove('tourOpen');
  clearTourTarget();
  if (saveSeen) localStorage.setItem('ratTourSeen', 'true');
  if (previousFocusedElement && previousFocusedElement.focus) previousFocusedElement.focus();
}

function initialiseTour() {
  $('startTour').addEventListener('click', openTour);
  $('tourSkip').addEventListener('click', () => closeTour(true));
  $('tourBack').addEventListener('click', () => showTourStep(currentTourStep - 1));
  $('tourNext').addEventListener('click', () => {
    if (currentTourStep === tourSteps.length - 1) closeTour(true);
    else showTourStep(currentTourStep + 1);
  });
  $('tourBackdrop').addEventListener('click', () => closeTour(true));
  document.addEventListener('wheel', (event) => {
    if (!$('tourOverlay').hidden) event.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', (event) => {
    if (!$('tourOverlay').hidden && !event.target.closest('#tourPanel')) event.preventDefault();
  }, { passive: false });
  window.addEventListener('scroll', () => {
    if (!$('tourOverlay').hidden) positionTourStep();
  });
  window.addEventListener('resize', () => {
    if (!$('tourOverlay').hidden) positionTourStep();
  });
  document.addEventListener('keydown', (event) => {
    if ($('tourOverlay').hidden) return;
    const scrollKeys = [' ', 'PageDown', 'PageUp', 'Home', 'End', 'ArrowUp', 'ArrowDown'];
    if (scrollKeys.includes(event.key)) event.preventDefault();
    if (event.key === 'Escape') closeTour(true);
    if (event.key === 'ArrowRight') $('tourNext').click();
    if (event.key === 'ArrowLeft' && currentTourStep > 0) $('tourBack').click();
  });

  if (!localStorage.getItem('ratTourSeen')) {
    window.setTimeout(openTour, 800);
  }
}

initialiseTour();
loadRepositories().catch((err) => setStatus(err.message, true));
