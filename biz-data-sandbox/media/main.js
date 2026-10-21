// @ts-check
// BizData Sandbox webview: renders the selected module, its code tabs and the live simulator.
(function () {
  'use strict';

  /** @type {any} */
  const w = window;
  const vscode = w.acquireVsCodeApi();
  const { modules, languageNames } = w.BizScenarios;
  const LANGS = ['sql', 'r', 'eviews'];
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const editor = /** @type {HTMLTextAreaElement} */ ($('codeEditor'));

  // ---------- state ----------

  const saved = vscode.getState() || {};
  const state = {
    moduleId: saved.moduleId || modules[0].id,
    lang: saved.lang || 'sql',
    /** @type {Record<string, Record<string, number>>} */
    params: saved.params || {},
    /** User edits keyed by `${moduleId}:${lang}`; absent means "show the generated reference code". */
    /** @type {Record<string, string>} */
    edits: saved.edits || {},
  };
  for (const m of modules) {
    state.params[m.id] = Object.assign(
      Object.fromEntries(m.params.map((p) => [p.id, p.value])),
      state.params[m.id] || {},
    );
  }

  const persist = () => vscode.setState(state);
  const currentModule = () => modules.find((m) => m.id === state.moduleId) || modules[0];
  const editKey = () => `${state.moduleId}:${state.lang}`;
  const referenceCode = () => currentModule().code[state.lang](state.params[state.moduleId]);

  // ---------- rendering ----------

  function renderModulePicker() {
    const nav = $('modulePicker');
    nav.replaceChildren(
      ...modules.map((m) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'module-btn' + (m.id === state.moduleId ? ' active' : '');
        btn.setAttribute('aria-pressed', String(m.id === state.moduleId));
        btn.innerHTML = `<span class="module-icon" aria-hidden="true">${m.icon}</span><span>${m.name}</span>
          <span class="module-langs">${m.languages.map((l) => languageNames[l]).join(' · ')}</span>`;
        btn.addEventListener('click', () => {
          state.moduleId = m.id;
          if (!m.languages.includes(state.lang)) state.lang = m.languages[0];
          persist();
          renderAll();
        });
        return btn;
      }),
    );
  }

  function renderScenario() {
    const m = currentModule();
    $('scenarioModule').textContent = `${m.icon} ${m.name}`;
    $('scenarioTitle').textContent = m.title;
    $('scenarioProblem').textContent = m.problem;
    $('scenarioWorkflow').replaceChildren(
      ...m.workflow.map((step) => {
        const li = document.createElement('li');
        const tag = document.createElement('button');
        tag.type = 'button';
        tag.className = 'lang-tag lang-' + step.lang;
        tag.textContent = languageNames[step.lang];
        tag.title = `Show the ${languageNames[step.lang]} step`;
        tag.addEventListener('click', () => selectLang(step.lang));
        li.append(tag, document.createTextNode(' ' + step.text));
        return li;
      }),
    );
    $('scenarioConcepts').replaceChildren(
      ...m.concepts.flatMap(([term, def]) => {
        const dt = document.createElement('dt');
        dt.textContent = term;
        const dd = document.createElement('dd');
        dd.textContent = def;
        return [dt, dd];
      }),
    );
  }

  function selectLang(lang) {
    if (!currentModule().languages.includes(lang)) return;
    state.lang = lang;
    persist();
    renderTabs();
    renderCode();
  }

  function renderTabs() {
    const m = currentModule();
    const tabs = $('langTabs');
    tabs.replaceChildren(
      ...LANGS.map((lang) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('role', 'tab');
        const available = m.languages.includes(lang);
        const active = lang === state.lang;
        btn.className = 'tab' + (active ? ' active' : '');
        btn.setAttribute('aria-selected', String(active));
        btn.disabled = !available;
        btn.textContent = languageNames[lang];
        if (!available) btn.title = `${languageNames[lang]} is used in the Macro Forecasting module`;
        btn.addEventListener('click', () => selectLang(lang));
        return btn;
      }),
    );
  }

  function renderCode() {
    const m = currentModule();
    const edited = state.edits[editKey()];
    editor.value = edited ?? referenceCode();
    $('codeCaption').textContent = m.captions[state.lang];
    $('codeHint').textContent =
      edited !== undefined
        ? 'You have edited this snippet — slider changes no longer rewrite it. Press Reset to restore the reference solution.'
        : 'Reference solution. Edit freely to experiment, or open it in a real editor tab.';
    $('resetBtn').toggleAttribute('disabled', edited === undefined);
  }

  function renderControls() {
    const m = currentModule();
    const values = state.params[m.id];
    $('simControls').replaceChildren(
      ...m.params.map((p) => {
        const wrap = document.createElement('label');
        wrap.className = 'control';
        const head = document.createElement('span');
        head.className = 'control-head';
        const name = document.createElement('span');
        name.textContent = p.label;
        const out = document.createElement('output');
        out.textContent = formatParam(p, values[p.id]);
        head.append(name, out);
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(p.min);
        input.max = String(p.max);
        input.step = String(p.step);
        input.value = String(values[p.id]);
        input.setAttribute('aria-label', p.label);
        input.addEventListener('input', () => {
          values[p.id] = Number(input.value);
          out.textContent = formatParam(p, values[p.id]);
          persist();
          renderSimulation();
          if (state.edits[editKey()] === undefined) renderCode();
        });
        wrap.append(head, input);
        return wrap;
      }),
    );
  }

  function formatParam(p, v) {
    const digits = String(p.step).includes('.') ? String(p.step).split('.')[1].length : 0;
    const n = Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    switch (p.unit) {
      case '$':
        return '$' + n;
      case '$k':
        return '$' + n + 'k';
      case '%':
        return n + '%';
      case '':
        return n;
      default:
        return `${n} ${p.unit}`;
    }
  }

  function renderSimulation() {
    const m = currentModule();
    const result = m.simulate(state.params[m.id]);

    $('simKpis').replaceChildren(
      ...result.kpis.map((k) => {
        const div = document.createElement('div');
        div.className = 'kpi' + (k.tone ? ' ' + k.tone : '');
        div.innerHTML = '<span class="kpi-label"></span><span class="kpi-value"></span>';
        /** @type {HTMLElement} */ (div.firstChild).textContent = k.label;
        /** @type {HTMLElement} */ (div.lastChild).textContent = k.value;
        return div;
      }),
    );

    const chartEl = $('simChart');
    chartEl.setAttribute('aria-label', result.chart.title);
    chartEl.replaceChildren(chartTitle(result.chart.title), result.chart.kind === 'bar' ? barChart(result.chart) : lineChart(result.chart));

    const table = $('simTable');
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    for (const c of result.table.columns) {
      const th = document.createElement('th');
      th.textContent = c;
      hr.append(th);
    }
    thead.append(hr);
    const tbody = document.createElement('tbody');
    for (const row of result.table.rows) {
      const tr = document.createElement('tr');
      for (const cell of row) {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.replaceChildren(thead, tbody);
  }

  function renderAll() {
    renderModulePicker();
    renderScenario();
    renderTabs();
    renderCode();
    renderControls();
    renderSimulation();
  }

  // ---------- charts (dependency-free SVG) ----------

  const W = 640;
  const H = 260;
  const M = { top: 12, right: 16, bottom: 28, left: 64 };

  function svgEl(tag, attrs, text) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function chartTitle(text) {
    const div = document.createElement('div');
    div.className = 'chart-title';
    div.textContent = text;
    return div;
  }

  function niceTicks(min, max, count) {
    const span = max - min || Math.abs(max) || 1;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= raw) || raw;
    const lo = Math.floor(min / step) * step;
    const hi = Math.ceil(max / step) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)));
    return ticks;
  }

  function axes(svg, ticks, y, fmt) {
    for (const t of ticks) {
      const yy = y(t);
      svg.append(svgEl('line', { x1: M.left, x2: W - M.right, y1: yy, y2: yy, class: 'grid' }));
      svg.append(svgEl('text', { x: M.left - 8, y: yy + 4, class: 'axis-label', 'text-anchor': 'end' }, fmt(t)));
    }
  }

  function barChart(spec) {
    const s = spec.series[0];
    const max = Math.max(...s.values, 0);
    const ticks = niceTicks(0, max, 4);
    const top = ticks[ticks.length - 1];
    const y = (v) => M.top + (H - M.top - M.bottom) * (1 - v / top);
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg' });
    axes(svg, ticks, y, s.format);
    const band = (W - M.left - M.right) / s.values.length;
    s.values.forEach((v, i) => {
      const x = M.left + i * band + band * 0.18;
      const bw = band * 0.64;
      const rect = svgEl('rect', { x, y: y(v), width: bw, height: Math.max(0, y(0) - y(v)), rx: 3, class: 'bar' });
      rect.append(svgEl('title', {}, `${spec.labels[i]}: ${s.format(v)}`));
      svg.append(rect);
      svg.append(svgEl('text', { x: x + bw / 2, y: y(v) - 5, class: 'bar-label', 'text-anchor': 'middle' }, s.format(v)));
      svg.append(svgEl('text', { x: x + bw / 2, y: H - 8, class: 'axis-label', 'text-anchor': 'middle' }, spec.labels[i]));
    });
    return svg;
  }

  function lineChart(spec) {
    const vals = [
      ...spec.series.flatMap((s) => s.values),
      ...(spec.band ? [...spec.band.lower, ...spec.band.upper] : []),
    ].filter((v) => v !== null);
    if (spec.zeroLine) vals.push(0);
    const ticks = niceTicks(Math.min(...vals), Math.max(...vals), 4);
    const lo = ticks[0];
    const hi = ticks[ticks.length - 1];
    const n = spec.labels.length;
    const x = (i) => M.left + ((W - M.left - M.right) * i) / (n - 1);
    const y = (v) => M.top + (H - M.top - M.bottom) * (1 - (v - lo) / (hi - lo || 1));
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart-svg' });
    axes(svg, ticks, y, spec.format);

    if (spec.zeroLine && lo < 0) {
      svg.append(svgEl('line', { x1: M.left, x2: W - M.right, y1: y(0), y2: y(0), class: 'zero-line' }));
    }

    if (spec.band) {
      const idx = spec.band.lower.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
      const upper = idx.map((i) => `${x(i)},${y(spec.band.upper[i])}`);
      const lower = idx.reverse().map((i) => `${x(i)},${y(spec.band.lower[i])}`);
      svg.append(svgEl('polygon', { points: [...upper, ...lower].join(' '), class: 'band' }));
    }

    spec.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
      svg.append(svgEl('polyline', { points: pts.join(' '), class: `line series-${si}` + (s.dashed ? ' dashed' : '') }));
      s.values.forEach((v, i) => {
        if (v === null) return;
        const dot = svgEl('circle', { cx: x(i), cy: y(v), r: 6, class: 'hover-dot' });
        dot.append(svgEl('title', {}, `${spec.labels[i]} · ${s.name}: ${spec.format(v)}`));
        svg.append(dot);
      });
    });

    spec.labels.forEach((label, i) => {
      if (i % spec.labelEvery !== 0 && i !== n - 1) return;
      if (i !== n - 1 && n - 1 - i < spec.labelEvery / 2) return;
      svg.append(svgEl('text', { x: x(i), y: H - 8, class: 'axis-label', 'text-anchor': 'middle' }, label));
    });

    const legend = svgEl('g', { class: 'legend' });
    spec.series.forEach((s, si) => {
      const lx = M.left + 8 + si * 150;
      legend.append(svgEl('line', { x1: lx, x2: lx + 18, y1: M.top + 6, y2: M.top + 6, class: `line series-${si}` + (s.dashed ? ' dashed' : '') }));
      legend.append(svgEl('text', { x: lx + 24, y: M.top + 10, class: 'axis-label' }, s.name));
    });
    svg.append(legend);
    return svg;
  }

  // ---------- code actions ----------

  editor.addEventListener('input', () => {
    if (editor.value === referenceCode()) delete state.edits[editKey()];
    else state.edits[editKey()] = editor.value;
    persist();
    const edited = state.edits[editKey()] !== undefined;
    $('resetBtn').toggleAttribute('disabled', !edited);
  });

  // Keep Tab inside the editor (two spaces) instead of moving focus; Esc then Tab still leaves.
  let escPressed = false;
  editor.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      escPressed = true;
      return;
    }
    if (ev.key === 'Tab' && !ev.shiftKey && !escPressed) {
      ev.preventDefault();
      editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
      editor.dispatchEvent(new Event('input'));
    }
    escPressed = false;
  });

  $('resetBtn').addEventListener('click', () => {
    delete state.edits[editKey()];
    persist();
    renderCode();
  });
  $('copyBtn').addEventListener('click', () => vscode.postMessage({ type: 'copy', code: editor.value }));
  $('openBtn').addEventListener('click', () =>
    vscode.postMessage({ type: 'openInEditor', language: state.lang, code: editor.value }),
  );

  renderAll();
})();
