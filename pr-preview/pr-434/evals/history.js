const $ = id => document.getElementById(id);
const colors = ['#80ded0', '#e8b76b', '#b6a4f7', '#ee92b0', '#8abdf3', '#b7d876'];
const percentage = value => value == null ? 'Unscored' : `${(value * 100).toFixed(1)}%`;
let runs = [], filenames = [], selection = 0, names = [], types = {};
const typeLabels = { conversation: 'Conversation', review: 'Review', 'jev-decision': 'Jev decision', 'jev-action': 'Jev action', unclassified: 'Unclassified' };
function filterEvals() {
  const previous = $('eval').value;
  const filtered = names.filter(name => !$('type').value || (types[name] ?? 'unclassified') === $('type').value);
  $('eval').replaceChildren(...filtered.map(name => option(name, name)));
  if (filtered.includes(previous)) $('eval').value = previous;
  if (filtered.length) return loadEval();
}
$('type').addEventListener('change', filterEvals);
function option(value, text) {
  const item = document.createElement('option');
  item.value = value; item.textContent = text; return item;
}
async function json(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}
function svg(tag, attributes, text) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text !== undefined) element.textContent = text;
  return element;
}
function draw() {
  const metric = $('metric').value;
  const chart = $('chart'); chart.replaceChildren(); $('legend').replaceChildren();
  const x = i => runs.length === 1 ? 520 : 60 + i * 900 / (runs.length - 1);
  const y = value => 285 - value * 260;
  for (const value of [0, .25, .5, .75, 1]) {
    chart.append(svg('line', { x1: 60, x2: 960, y1: y(value), y2: y(value), stroke: '#30434c' }),
      svg('text', { x: 48, y: y(value) + 4, 'text-anchor': 'end' }, `${value * 100}%`));
  }
  runs.forEach((run, i) => {
    if (i % Math.max(1, Math.ceil(runs.length / 8)) === 0 || i === runs.length - 1)
      chart.append(svg('text', { x: x(i), y: 318, 'text-anchor': 'middle' }, run.revision.slice(0, 7)));
  });
  const variants = [...new Set(runs.flatMap(run => run.comparison.map(row => row.variant)))];
  variants.forEach((variant, index) => {
    const color = colors[index % colors.length];
    const label = document.createElement('span'); label.textContent = variant;
    label.style.borderColor = color; $('legend').append(label);
    let previous;
    runs.forEach((run, i) => {
      const row = run.comparison.find(row => row.variant === variant);
      const value = metric === 'total' ? row?.total : row?.criteria[metric];
      const rubric = JSON.stringify(run.rubric);
      if (value == null) { previous = undefined; return; }
      if (previous && previous.rubric === rubric)
        chart.append(svg('line', { x1: previous.x, y1: previous.y, x2: x(i), y2: y(value), stroke: color, 'stroke-width': 2 }));
      const point = svg('circle', { cx: x(i), cy: y(value), r: 5, fill: color, tabindex: 0, role: 'button',
        'aria-label': `${run.revision.slice(0, 7)}, ${variant}: ${percentage(value)}` });
      point.append(svg('title', {}, `${run.revision.slice(0, 7)} · ${variant}: ${percentage(value)} · ${row.runs} repeats`));
      const select = () => { $('commit').value = String(i); details(); };
      point.addEventListener('click', select);
      point.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } });
      chart.append(point); previous = { x: x(i), y: y(value), rubric };
    });
  });
}
function details() {
  const i = Number($('commit').value), run = runs[i];
  if (!run) return;
  const commit = document.createElement('a'); commit.textContent = run.revision.slice(0, 7);
  commit.href = `https://github.com/Tatskaari/kingmaker/commit/${encodeURIComponent(run.revision)}`;
  const raw = document.createElement('a'); raw.textContent = 'Scores JSON';
  raw.href = `${encodeURIComponent($('eval').value)}/${encodeURIComponent(filenames[i])}`;
  $('metadata').replaceChildren(commit, ` · Published ${new Date(run.publishedAt).toLocaleString()} · `, raw);
  const table = $('breakdown'); table.replaceChildren();
  const header = table.createTHead().insertRow();
  for (const text of ['Variant', 'Repeats', ...run.rubric.map(item => item.name), 'Total', 'Δ baseline', 'Run errors', 'Judge errors']) {
    const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = text; header.append(cell);
  }
  const body = table.createTBody();
  for (const row of run.comparison) {
    const tr = body.insertRow();
    const delta = row.delta == null ? '—' : `${row.delta >= 0 ? '+' : ''}${(row.delta * 100).toFixed(1)}pp`;
    for (const value of [row.variant + (row.baseline ? ' (baseline)' : ''), row.runs,
      ...run.rubric.map(item => percentage(row.criteria[item.name])), percentage(row.total), delta, row.executionErrors, row.scoringErrors])
      tr.insertCell().textContent = String(value);
  }
}
async function loadEval() {
  const token = ++selection;
  $('status').textContent = 'Loading historical results…';
  $('metric').disabled = $('commit').disabled = true;
  $('chart').replaceChildren(); $('legend').replaceChildren(); $('breakdown').replaceChildren(); $('metadata').replaceChildren();
  try {
    const name = encodeURIComponent($('eval').value);
    const files = await json(`${name}/index.json`);
    const results = await Promise.all(files.map(file => json(`${name}/${encodeURIComponent(file)}`)));
    if (token !== selection) return;
    filenames = files; runs = results;
    if (!runs.length) { $('status').textContent = 'No results have been published for this eval.'; return; }
    const criteria = [...new Set(runs.flatMap(run => run.rubric.map(item => item.name)))];
    $('metric').replaceChildren(option('total', 'Weighted total'), ...criteria.map(name => option(name, name)));
    $('commit').replaceChildren(...runs.map((run, i) => option(String(i), `${run.revision.slice(0, 7)} · ${new Date(run.publishedAt).toLocaleDateString()}`)).reverse());
    $('metric').disabled = $('commit').disabled = false;
    $('status').textContent = `${runs.length} commits · ${$('eval').value}`;
    draw(); details();
  } catch (error) {
    if (token === selection) $('status').textContent = `Could not load eval history: ${error.message}. Refresh to retry.`;
  }
}
$('eval').addEventListener('change', loadEval);
$('metric').addEventListener('change', draw);
$('commit').addEventListener('change', details);
try {
  names = await json('index.json');
  try { types = await json('types.json'); } catch { /* Older publications remain browsable as unclassified. */ }
  const groups = [...new Set(names.map(name => types[name] ?? 'unclassified'))].sort();
  $('type').replaceChildren(option('', 'All types'), ...groups.map(type => option(type, typeLabels[type] ?? type)));
  $('type').disabled = !names.length;
  $('eval').replaceChildren(...names.map(name => option(name, name)));
  $('eval').disabled = !names.length;
  if (names.length) await loadEval();
  else $('status').textContent = 'No eval results published yet. Run the Run evals workflow after setting OPENROUTER_EVAL_KEY.';
} catch {
  $('status').textContent = 'Eval history is not available yet. After the first Run evals workflow and Pages deployment, refresh this page.';
}
