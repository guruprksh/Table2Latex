/*
 * Table2Latex: editor UI.
 * Owns the table model, renders the editable grid, and pipes it through Table2Latex.generate.
 */
(function () {
  'use strict';

  const STORE_KEY = 'table2latex.v1';
  const SPLIT_KEY = 'table2latex.split';
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- model

  const emptyCell = () => ({ t: '', b: false, i: false, a: null });

  function newModel(R, C) {
    return {
      rows: R,
      cols: C,
      cells: Array.from({ length: R }, () => Array.from({ length: C }, emptyCell)),
      colSpec: new Array(C).fill('c'),
      merges: [],
      headerRows: Math.min(1, R),
    };
  }

  function demoModel() {
    const m = newModel(5, 4);
    const data = [
      ['Specimen', 'Crack depth (mm)', 'Harmonic ratio', ''],
      ['', '', '$A_2/A_1$', '$A_3/A_1$'],
      ['A', '0.5', '0.012', '0.004'],
      ['B', '1.0', '0.031', '0.009'],
      ['C', '2.0', '0.074', '0.021'],
    ];
    data.forEach((row, r) => row.forEach((t, c) => (m.cells[r][c].t = t)));
    m.colSpec = ['l', 'c', 'c', 'c'];
    m.merges = [
      { r: 0, c: 0, rs: 2, cs: 1 },
      { r: 0, c: 1, rs: 2, cs: 1 },
      { r: 0, c: 2, rs: 1, cs: 2 },
    ];
    m.headerRows = 2;
    return m;
  }

  let model = demoModel();
  let sel = null; // { r1, c1, r2, c2 }
  let anchor = null; // { r, c }
  let dragging = false;

  function ownerMap() {
    const owner = Array.from({ length: model.rows }, () => new Array(model.cols).fill(null));
    for (const m of model.merges) {
      for (let r = m.r; r < m.r + m.rs; r++) for (let c = m.c; c < m.c + m.cs; c++) owner[r][c] = m;
    }
    return owner;
  }

  function mergeAt(r, c) {
    return model.merges.find((m) => r >= m.r && r < m.r + m.rs && c >= m.c && c < m.c + m.cs) || null;
  }

  // Anchor (top-left) of whatever occupies (r, c)
  function anchorOf(r, c) {
    const m = mergeAt(r, c);
    return m ? { r: m.r, c: m.c } : { r, c };
  }

  // Grow a rectangle until it fully contains every merge it touches.
  function expandRect(r1, c1, r2, c2) {
    let a = { r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2) };
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of model.merges) {
        const mr2 = m.r + m.rs - 1;
        const mc2 = m.c + m.cs - 1;
        const hit = m.r <= a.r2 && mr2 >= a.r1 && m.c <= a.c2 && mc2 >= a.c1;
        if (!hit) continue;
        const n = {
          r1: Math.min(a.r1, m.r),
          c1: Math.min(a.c1, m.c),
          r2: Math.max(a.r2, mr2),
          c2: Math.max(a.c2, mc2),
        };
        if (n.r1 !== a.r1 || n.c1 !== a.c1 || n.r2 !== a.r2 || n.c2 !== a.c2) {
          a = n;
          changed = true;
        }
      }
    }
    return a;
  }

  function clampSel() {
    if (!sel) return;
    const R = model.rows - 1;
    const C = model.cols - 1;
    sel = expandRect(Math.min(sel.r1, R), Math.min(sel.c1, C), Math.min(sel.r2, R), Math.min(sel.c2, C));
    if (anchor) anchor = anchorOf(Math.min(anchor.r, R), Math.min(anchor.c, C));
  }

  // Visit the anchor of each distinct cell in the selection.
  function forEachSelected(fn) {
    if (!sel) return;
    const owner = ownerMap();
    for (let r = sel.r1; r <= sel.r2; r++) {
      for (let c = sel.c1; c <= sel.c2; c++) {
        const m = owner[r][c];
        if (m && (m.r !== r || m.c !== c)) continue;
        fn(model.cells[r][c], r, c);
      }
    }
  }

  // ---------------------------------------------------------------- structure ops

  function insertRow(at) {
    model.cells.splice(at, 0, Array.from({ length: model.cols }, emptyCell));
    model.rows++;
    for (const m of model.merges) {
      if (at <= m.r) m.r++;
      else if (at < m.r + m.rs) m.rs++;
    }
    if (at < model.headerRows) model.headerRows++;
  }

  function deleteRow(i) {
    for (const m of model.merges) {
      if (m.r === i && m.rs > 1) model.cells[i + 1][m.c] = model.cells[i][m.c];
    }
    model.cells.splice(i, 1);
    model.rows--;
    for (const m of model.merges) {
      if (i < m.r) m.r--;
      else if (i < m.r + m.rs) m.rs--;
    }
    if (i < model.headerRows) model.headerRows--;
    pruneMerges();
  }

  function insertCol(at) {
    model.cells.forEach((row) => row.splice(at, 0, emptyCell()));
    model.colSpec.splice(at, 0, 'c');
    model.cols++;
    for (const m of model.merges) {
      if (at <= m.c) m.c++;
      else if (at < m.c + m.cs) m.cs++;
    }
  }

  function deleteCol(j) {
    for (const m of model.merges) {
      if (m.c === j && m.cs > 1) model.cells[m.r][j + 1] = model.cells[m.r][j];
    }
    model.cells.forEach((row) => row.splice(j, 1));
    model.colSpec.splice(j, 1);
    model.cols--;
    for (const m of model.merges) {
      if (j < m.c) m.c--;
      else if (j < m.c + m.cs) m.cs--;
    }
    pruneMerges();
  }

  function pruneMerges() {
    model.merges = model.merges.filter((m) => m.rs > 0 && m.cs > 0 && m.rs * m.cs > 1);
  }

  function ensureSize(R, C) {
    while (model.rows < R) insertRow(model.rows);
    while (model.cols < C) insertCol(model.cols);
  }

  // ---------------------------------------------------------------- history & persistence

  const undoStack = [];
  const redoStack = [];
  let editSnap = null; // snapshot taken when a text edit session starts

  const snap = () => JSON.stringify(model);

  function flushEdit() {
    if (editSnap !== null) {
      const now = snap();
      if (now !== editSnap) {
        undoStack.push(editSnap);
        redoStack.length = 0;
        editSnap = now;
      }
    }
  }

  // A merge that starts in the header and reaches below it extends the header.
  function syncHeaderRows() {
    const H = Table2Latex.effectiveHeaderRows(model);
    if (H !== model.headerRows) {
      model.headerRows = H;
      toast('Header extended to ' + H + ' rows to include merged header cells');
    }
  }

  // Run a structural change with undo support, then re-render.
  function commit(fn) {
    flushEdit();
    const before = snap();
    fn();
    syncHeaderRows();
    if (snap() === before) return;
    undoStack.push(before);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    // re-rendering may drop focus without a focusout; never replay a stale snapshot
    if (editSnap !== null) editSnap = snap();
    clampSel();
    render();
    changed();
  }

  function restore(json) {
    model = JSON.parse(json);
    editSnap = null;
    clampSel();
    render();
    changed();
  }

  function undo() {
    flushEdit();
    if (!undoStack.length) return toast('Nothing to undo');
    redoStack.push(snap());
    restore(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return toast('Nothing to redo');
    undoStack.push(snap());
    restore(redoStack.pop());
  }

  const OPT_IDS = {
    style: 'optStyle', float: 'optFloat', size: 'optSize', caption: 'optCaption', label: 'optLabel',
    capPos: 'optCapPos', env: 'optEnv', center: 'optCenter', boldHeader: 'optBoldHeader',
    widthMode: 'optWidthMode', width: 'optWidth', span: 'optSpan', colSep: 'optColSep', stretch: 'optStretch', vspace: 'optVspace',
    escape: 'optEscape', cmidrule: 'optCmid', alignAmp: 'optAlignAmp', live: 'optLive',
  };

  function readOpts() {
    const o = {};
    for (const [k, id] of Object.entries(OPT_IDS)) {
      const el = $(id);
      o[k] = el.type === 'checkbox' ? el.checked : el.value.trim();
    }
    return o;
  }

  function syncWidthUI() {
    $('optWidth').disabled = $('optWidthMode').value === 'natural';
  }

  function writeOpts(o) {
    // older saves had a single "fit to \textwidth" checkbox
    if (o.resize && !('widthMode' in o)) o = Object.assign({}, o, { widthMode: 'scale', width: '\\textwidth' });
    for (const [k, id] of Object.entries(OPT_IDS)) {
      if (!(k in o)) continue;
      const el = $(id);
      if (el.type === 'checkbox') el.checked = !!o[k];
      else el.value = o[k];
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ model, opts: readOpts() }));
    } catch (e) { /* storage unavailable */ }
  }

  function validModel(m) {
    return m && Number.isInteger(m.rows) && Number.isInteger(m.cols) && Array.isArray(m.cells) &&
      m.cells.length === m.rows && m.cells.every((row) => Array.isArray(row) && row.length === m.cols) &&
      Array.isArray(m.merges) && Array.isArray(m.colSpec);
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (validModel(data.model)) {
        model = data.model;
        model.headerRows = Table2Latex.effectiveHeaderRows(model);
      }
      if (data.opts) writeOpts(data.opts);
    } catch (e) { /* ignore corrupt storage */ }
  }

  // ---------------------------------------------------------------- rendering

  const editor = $('editor');
  const escHtml = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const ALIGN_CSS = { l: 'left', c: 'center', r: 'right' };

  function colName(c) {
    let s = '';
    c++;
    while (c > 0) {
      const k = (c - 1) % 26;
      s = String.fromCharCode(65 + k) + s;
      c = Math.floor((c - 1) / 26);
    }
    return s;
  }

  function baseAlign(spec) {
    const m = /^[|\s]*([lcr])/.exec(spec || '');
    return m ? m[1] : 'c';
  }

  function render() {
    const owner = ownerMap();
    const H = model.headerRows;
    const boldHdr = $('optBoldHeader').checked;
    let h = '<thead><tr><th class="corner"></th>';
    for (let c = 0; c < model.cols; c++) {
      h += '<th class="colh" data-col="' + c + '"><span class="colname" data-col="' + c + '" title="Select column">' +
        colName(c) + '</span><input data-spec="' + c + '" value="' + escHtml(model.colSpec[c] || '') +
        '" spellcheck="false" autocomplete="off" title="Column spec: l, c, r, p{3cm}, S, …"></th>';
    }
    h += '</tr></thead><tbody>';
    for (let r = 0; r < model.rows; r++) {
      const label = r < H ? 'H' + (H > 1 ? r + 1 : '') : String(r - H + 1);
      h += '<tr><th class="rowh' + (r < H ? ' hdrrow' : '') + '" data-row="' + r + '" title="Select row">' + label + '</th>';
      for (let c = 0; c < model.cols; c++) {
        const m = owner[r][c];
        if (m && (m.r !== r || m.c !== c)) continue;
        const cell = model.cells[r][c];
        const cls = ['cell'];
        if (r < H) cls.push('hdr');
        if (r < H && boldHdr) cls.push('boldhdr');
        if (cell.b) cls.push('b');
        if (cell.i) cls.push('i');
        if (m) cls.push('merged');
        const align = ALIGN_CSS[cell.a || baseAlign(model.colSpec[c])];
        h += '<td class="' + cls.join(' ') + '" contenteditable="true" spellcheck="false" data-r="' + r + '" data-c="' + c + '"' +
          (m && m.rs > 1 ? ' rowspan="' + m.rs + '"' : '') +
          (m && m.cs > 1 ? ' colspan="' + m.cs + '"' : '') +
          ' style="text-align:' + align + '">' + escHtml(cell.t || '') + '</td>';
      }
      h += '</tr>';
    }
    h += '</tbody>';
    editor.innerHTML = h;
    $('headerRows').max = model.rows;
    $('headerRows').value = model.headerRows;
    paintSel();
  }

  function paintSel() {
    editor.querySelectorAll('td.cell').forEach((td) => {
      const r = +td.dataset.r;
      const c = +td.dataset.c;
      const inSel = sel && r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2;
      const multi = sel && (sel.r1 !== sel.r2 || sel.c1 !== sel.c2) && !mergeCovers(sel);
      td.classList.toggle('sel', !!(inSel && multi));
      td.classList.toggle('anchor', !!(anchor && multi && anchor.r === r && anchor.c === c));
    });
    editor.querySelectorAll('th.rowh').forEach((th) => {
      const r = +th.dataset.row;
      th.classList.toggle('on', !!(sel && r >= sel.r1 && r <= sel.r2));
    });
    editor.querySelectorAll('th.colh').forEach((th) => {
      const c = +th.dataset.col;
      th.classList.toggle('on', !!(sel && c >= sel.c1 && c <= sel.c2));
    });
    updateSelInfo();
  }

  // True when the selection is exactly one merged cell
  function mergeCovers(s) {
    const m = mergeAt(s.r1, s.c1);
    return !!m && m.r === s.r1 && m.c === s.c1 && m.r + m.rs - 1 === s.r2 && m.c + m.cs - 1 === s.c2;
  }

  function updateSelInfo() {
    const info = $('selInfo');
    if (!sel) {
      info.textContent = 'Click a cell to edit. Drag or Shift+click to select several cells, then merge.';
      return;
    }
    const ref = (r, c) => colName(c) + (r + 1);
    const rows = sel.r2 - sel.r1 + 1;
    const cols = sel.c2 - sel.c1 + 1;
    let txt = 'Selected ' + ref(sel.r1, sel.c1) + (rows * cols > 1 ? ':' + ref(sel.r2, sel.c2) + ' (' + rows + ' × ' + cols + ')' : '');
    if (mergeCovers(sel)) txt += ', merged cell: Unmerge splits it';
    else if (rows * cols > 1) txt += ', press Merge (Ctrl+M) to combine';
    info.textContent = txt;
  }

  // ---------------------------------------------------------------- output

  const outEl = $('output');
  const codeEl = $('outputCode');
  let lastCode = '';

  function highlight(code) {
    const re = /(\\[a-zA-Z@]+\*?|\\.)|(%[^\n]*)|(\$[^$\n]*\$)|([{}\[\]])|(&)/g;
    let html = '';
    let last = 0;
    let m;
    while ((m = re.exec(code))) {
      html += escHtml(code.slice(last, m.index));
      const t = escHtml(m[0]);
      if (m[1]) html += '<span class="tok-cmd">' + t + '</span>';
      else if (m[2]) html += '<span class="tok-com">' + t + '</span>';
      else if (m[3]) html += '<span class="tok-math">' + t + '</span>';
      else if (m[4]) html += '<span class="tok-brace">' + t + '</span>';
      else html += '<span class="tok-amp">' + t + '</span>';
      last = re.lastIndex;
    }
    return html + escHtml(code.slice(last));
  }

  function convert() {
    const opts = readOpts();
    const { code, packages } = Table2Latex.generate(model, opts);
    lastCode = code;
    codeEl.innerHTML = highlight(code);
    outEl.classList.remove('stale');
    $('pkgInfo').textContent = packages.length ? 'Packages: ' + packages.join(', ') : 'No extra packages needed';
  }

  // Called after any model or option change
  function changed() {
    if ($('optLive').checked) convert();
    else outEl.classList.add('stale');
    save();
  }

  // ---------------------------------------------------------------- selection & focus

  function setSel(r1, c1, r2, c2) {
    sel = expandRect(r1, c1, r2, c2);
    paintSel();
  }

  function selectCell(r, c) {
    anchor = anchorOf(r, c);
    setSel(anchor.r, anchor.c, anchor.r, anchor.c);
  }

  function tdAt(r, c) {
    const a = anchorOf(r, c);
    return editor.querySelector('td[data-r="' + a.r + '"][data-c="' + a.c + '"]');
  }

  function focusCell(r, c) {
    const td = tdAt(r, c);
    if (!td) return;
    selectCell(r, c);
    td.focus();
    const range = document.createRange();
    range.selectNodeContents(td);
    range.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }

  // Anchors in reading order
  function anchorList() {
    const owner = ownerMap();
    const list = [];
    for (let r = 0; r < model.rows; r++) {
      for (let c = 0; c < model.cols; c++) {
        const m = owner[r][c];
        if (!m || (m.r === r && m.c === c)) list.push({ r, c });
      }
    }
    return list;
  }

  function moveHorizontal(r, c, dir) {
    const list = anchorList();
    const i = list.findIndex((p) => p.r === r && p.c === c);
    let j = i + dir;
    if (j >= list.length) {
      commit(() => insertRow(model.rows));
      return focusCell(model.rows - 1, 0);
    }
    if (j < 0) j = 0;
    focusCell(list[j].r, list[j].c);
  }

  function moveVertical(r, c, dir) {
    const m = mergeAt(r, c);
    let nr = dir > 0 ? (m ? m.r + m.rs : r + 1) : (m ? m.r : r) - 1;
    if (nr >= model.rows) {
      if (dir > 0) {
        commit(() => insertRow(model.rows));
        nr = model.rows - 1;
      } else return;
    }
    if (nr < 0) return;
    focusCell(nr, c);
  }

  // ---------------------------------------------------------------- cell text

  function readCellText(td) {
    return td.innerText.replace(/​/g, '').replace(/\r/g, '').replace(/\n$/, '');
  }

  function parseDelimited(text) {
    text = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
    const first = text.split('\n')[0];
    let delim = '\t';
    if (!first.includes('\t')) {
      const counts = { ',': 0, ';': 0 };
      for (const ch of first) if (ch in counts) counts[ch]++;
      delim = counts[';'] > counts[','] ? ';' : ',';
    }
    const rows = [];
    let row = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"' && cur === '') q = true;
      else if (ch === delim) { row.push(cur); cur = ''; }
      else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    row.push(cur);
    rows.push(row);
    return rows;
  }

  function pasteGrid(r0, c0, rows) {
    commit(() => {
      const width = Math.max(...rows.map((r) => r.length));
      ensureSize(r0 + rows.length, c0 + width);
      const owner = ownerMap();
      rows.forEach((row, i) => row.forEach((t, j) => {
        const r = r0 + i;
        const c = c0 + j;
        const m = owner[r][c];
        if (m && (m.r !== r || m.c !== c)) return;
        model.cells[r][c].t = t.trim();
      }));
    });
    setSel(r0, c0, r0 + rows.length - 1, c0 + Math.max(...rows.map((r) => r.length)) - 1);
  }

  // ---------------------------------------------------------------- editor events

  editor.addEventListener('mousedown', (e) => {
    const rowh = e.target.closest('th.rowh');
    const colh = e.target.closest('.colname');
    if (rowh) {
      e.preventDefault();
      const r = +rowh.dataset.row;
      if (e.shiftKey && sel) setSel(Math.min(sel.r1, r), 0, Math.max(sel.r2, r), model.cols - 1);
      else { anchor = anchorOf(r, 0); setSel(r, 0, r, model.cols - 1); }
      return;
    }
    if (colh) {
      e.preventDefault();
      const c = +colh.dataset.col;
      if (e.shiftKey && sel) setSel(0, Math.min(sel.c1, c), model.rows - 1, Math.max(sel.c2, c));
      else { anchor = anchorOf(0, c); setSel(0, c, model.rows - 1, c); }
      return;
    }
    const td = e.target.closest('td.cell');
    if (!td || e.button !== 0) return;
    const r = +td.dataset.r;
    const c = +td.dataset.c;
    if (e.shiftKey && anchor) {
      e.preventDefault();
      setSel(anchor.r, anchor.c, r, c);
      return;
    }
    selectCell(r, c);
    dragging = true;
  });

  editor.addEventListener('mouseover', (e) => {
    if (!dragging) return;
    const td = e.target.closest('td.cell');
    if (!td) return;
    const r = +td.dataset.r;
    const c = +td.dataset.c;
    if (r === anchor.r && c === anchor.c) return;
    editor.classList.add('selecting');
    window.getSelection().removeAllRanges();
    setSel(anchor.r, anchor.c, r, c);
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
    editor.classList.remove('selecting');
  });

  editor.addEventListener('focusin', (e) => {
    editSnap = snap();
    const td = e.target.closest('td.cell');
    if (!td) return;
    const r = +td.dataset.r;
    const c = +td.dataset.c;
    const inside = sel && r >= sel.r1 && r <= sel.r2 && c >= sel.c1 && c <= sel.c2;
    if (!inside) selectCell(r, c);
  });

  editor.addEventListener('focusout', () => {
    flushEdit();
    editSnap = null;
  });

  editor.addEventListener('input', (e) => {
    const td = e.target.closest('td.cell');
    if (td) {
      model.cells[+td.dataset.r][+td.dataset.c].t = readCellText(td);
      changed();
      return;
    }
    const spec = e.target.dataset && e.target.dataset.spec;
    if (spec !== undefined) {
      model.colSpec[+spec] = e.target.value;
      // keep editor alignment preview in sync without re-rendering (keeps focus)
      const c = +spec;
      editor.querySelectorAll('td.cell[data-c="' + c + '"]').forEach((cellTd) => {
        const cell = model.cells[+cellTd.dataset.r][c];
        cellTd.style.textAlign = ALIGN_CSS[cell.a || baseAlign(e.target.value)];
      });
      changed();
    }
  });

  editor.addEventListener('paste', (e) => {
    const td = e.target.closest('td.cell');
    if (!td) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    if (!text) return;
    const trimmed = text.replace(/\r?\n$/, '');
    if (trimmed.includes('\t') || trimmed.includes('\n')) {
      pasteGrid(+td.dataset.r, +td.dataset.c, parseDelimited(trimmed));
      toast('Pasted ' + parseDelimited(trimmed).length + ' row(s)');
    } else {
      document.execCommand('insertText', false, trimmed);
    }
  });

  editor.addEventListener('drop', (e) => {
    if (e.target.closest('td.cell')) e.preventDefault();
  });

  editor.addEventListener('keydown', (e) => {
    const td = e.target.closest('td.cell');
    if (!td) return;
    const r = +td.dataset.r;
    const c = +td.dataset.c;
    const multi = sel && (sel.r1 !== sel.r2 || sel.c1 !== sel.c2) && !mergeCovers(sel);
    if (e.key === 'Tab') {
      e.preventDefault();
      moveHorizontal(r, c, e.shiftKey ? -1 : 1);
    } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      moveVertical(r, c, 1);
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !e.shiftKey && !readCellText(td).includes('\n')) {
      e.preventDefault();
      moveVertical(r, c, e.key === 'ArrowDown' ? 1 : -1);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && multi) {
      e.preventDefault();
      clearSel();
    } else if (e.key === 'Escape') {
      td.blur();
    }
  });

  // ---------------------------------------------------------------- actions

  function needSel() {
    if (!sel) toast('Select a cell first');
    return !!sel;
  }

  function mergeSel() {
    if (!needSel()) return;
    if (sel.r1 === sel.r2 && sel.c1 === sel.c2) return toast('Select two or more cells to merge');
    if (mergeCovers(sel)) return toast('Already merged');
    commit(() => {
      const s = sel;
      const texts = [];
      forEachSelected((cell) => { if (cell.t.trim()) texts.push(cell.t.trim()); });
      const top = model.cells[s.r1][s.c1];
      model.merges = model.merges.filter((m) => !(m.r >= s.r1 && m.r <= s.r2 && m.c >= s.c1 && m.c <= s.c2));
      for (let r = s.r1; r <= s.r2; r++) {
        for (let c = s.c1; c <= s.c2; c++) if (r !== s.r1 || c !== s.c1) model.cells[r][c] = emptyCell();
      }
      top.t = texts.join(' ');
      model.merges.push({ r: s.r1, c: s.c1, rs: s.r2 - s.r1 + 1, cs: s.c2 - s.c1 + 1 });
      anchor = { r: s.r1, c: s.c1 };
    });
  }

  function unmergeSel() {
    if (!needSel()) return;
    const s = sel;
    const hit = model.merges.filter((m) => m.r >= s.r1 && m.r <= s.r2 && m.c >= s.c1 && m.c <= s.c2);
    if (!hit.length) return toast('No merged cells in selection');
    commit(() => {
      model.merges = model.merges.filter((m) => !hit.includes(m));
    });
  }

  function clearSel() {
    if (!needSel()) return;
    commit(() => forEachSelected((cell) => { cell.t = ''; }));
  }

  function toggleFmt(key) {
    if (!needSel()) return;
    let all = true;
    forEachSelected((cell) => { if (!cell[key]) all = false; });
    commit(() => forEachSelected((cell) => { cell[key] = !all; }));
  }

  function setAlign(a) {
    if (!needSel()) return;
    commit(() => forEachSelected((cell) => { cell.a = a; }));
  }

  function rowOp(kind) {
    if (!needSel()) return;
    const s = sel;
    commit(() => {
      if (kind === 'above') insertRow(s.r1);
      else if (kind === 'below') insertRow(s.r2 + 1);
      else {
        const n = s.r2 - s.r1 + 1;
        if (n >= model.rows) return toast('A table needs at least one row');
        for (let r = s.r2; r >= s.r1; r--) deleteRow(r);
      }
    });
    if (kind === 'above') setSel(s.r1, s.c1, s.r1, s.c1);
    else if (kind === 'below') setSel(s.r2 + 1, s.c1, s.r2 + 1, s.c1);
  }

  function colOp(kind) {
    if (!needSel()) return;
    const s = sel;
    commit(() => {
      if (kind === 'left') insertCol(s.c1);
      else if (kind === 'right') insertCol(s.c2 + 1);
      else {
        const n = s.c2 - s.c1 + 1;
        if (n >= model.cols) return toast('A table needs at least one column');
        for (let c = s.c2; c >= s.c1; c--) deleteCol(c);
      }
    });
    if (kind === 'left') setSel(s.r1, s.c1, s.r1, s.c1);
    else if (kind === 'right') setSel(s.r1, s.c2 + 1, s.r1, s.c2 + 1);
  }

  function copyLatex() {
    convert();
    const done = () => toast('LaTeX copied to clipboard');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(lastCode).then(done, fallbackCopy);
    } else fallbackCopy();
    function fallbackCopy() {
      const ta = document.createElement('textarea');
      ta.value = lastCode;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed, select the code manually'); }
      ta.remove();
    }
  }

  function download(name, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function fileBase() {
    const label = $('optLabel').value.trim().replace(/^tab:/, '');
    return (label || 'table').replace(/[^\w.-]+/g, '_');
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---------------------------------------------------------------- wiring

  const on = (id, fn) => $(id).addEventListener('click', fn);

  on('btnMerge', mergeSel);
  on('btnUnmerge', unmergeSel);
  on('btnClear', clearSel);
  on('btnBold', () => toggleFmt('b'));
  on('btnItalic', () => toggleFmt('i'));
  on('btnAlignL', () => setAlign('l'));
  on('btnAlignC', () => setAlign('c'));
  on('btnAlignR', () => setAlign('r'));
  on('btnAlignReset', () => setAlign(null));
  on('btnRowAbove', () => rowOp('above'));
  on('btnRowBelow', () => rowOp('below'));
  on('btnRowDel', () => rowOp('delete'));
  on('btnColLeft', () => colOp('left'));
  on('btnColRight', () => colOp('right'));
  on('btnColDel', () => colOp('delete'));
  on('btnUndo', undo);
  on('btnRedo', redo);
  on('btnCopy', copyLatex);
  on('btnDownload', () => { convert(); download(fileBase() + '.tex', lastCode + '\n', 'text/x-tex'); });
  on('btnSaveJson', () => download(fileBase() + '.json', JSON.stringify({ model, opts: readOpts() }, null, 2), 'application/json'));
  on('btnHelp', () => $('dlgHelp').showModal());
  on('btnImport', () => { $('importText').value = ''; $('dlgImport').showModal(); });

  on('btnConvert', (e) => {
    e.stopPropagation();
    convert();
    const b = $('btnConvert');
    b.classList.remove('flash');
    void b.offsetWidth;
    b.classList.add('flash');
    toast('Converted to LaTeX');
  });

  on('btnNew', () => {
    const R = Math.max(1, Math.min(100, parseInt($('newRows').value, 10) || 4));
    const C = Math.max(1, Math.min(40, parseInt($('newCols').value, 10) || 4));
    commit(() => { model = newModel(R, C); sel = null; anchor = null; });
    focusCell(0, 0);
  });

  $('headerRows').addEventListener('change', (e) => {
    const v = Math.max(0, Math.min(model.rows, parseInt(e.target.value, 10) || 0));
    commit(() => { model.headerRows = v; });
    e.target.value = model.headerRows;
  });

  $('fileJson').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((txt) => {
      try {
        const data = JSON.parse(txt);
        const m = data.model || data;
        if (!validModel(m)) throw new Error('bad');
        commit(() => { model = m; sel = null; anchor = null; });
        if (data.opts) { writeOpts(data.opts); render(); changed(); }
        toast('Project loaded');
      } catch (err) {
        toast('Not a valid Table2Latex project file');
      }
      e.target.value = '';
    });
  });

  $('fileCsv').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    f.text().then((txt) => { $('importText').value = txt; });
    e.target.value = '';
  });

  $('btnDoImport').addEventListener('click', (e) => {
    const txt = $('importText').value;
    if (!txt.trim()) { e.preventDefault(); return toast('Paste some data first'); }
    const rows = parseDelimited(txt);
    const C = Math.max(...rows.map((r) => r.length));
    commit(() => {
      model = newModel(rows.length, C);
      rows.forEach((row, r) => row.forEach((t, c) => { model.cells[r][c].t = t.trim(); }));
      model.headerRows = $('importHeader').checked ? 1 : 0;
      sel = null;
      anchor = null;
    });
    toast('Imported ' + rows.length + ' × ' + C);
  });

  // options panel
  for (const id of Object.values(OPT_IDS)) {
    const el = $(id);
    el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
      if (id === 'optBoldHeader') render();
      if (id === 'optWidthMode') syncWidthUI();
      if (id === 'optLive' && el.checked) convert();
      changed();
    });
  }

  // global shortcuts
  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    const inField = e.target.matches('input, textarea, select');
    if (k === 'enter') { e.preventDefault(); $('btnConvert').click(); }
    else if (inField) return;
    else if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    else if (k === 'm') { e.preventDefault(); mergeSel(); }
    else if (k === 'b' && e.target.closest('#editor')) { e.preventDefault(); toggleFmt('b'); }
    else if (k === 'i' && e.target.closest('#editor')) { e.preventDefault(); toggleFmt('i'); }
  });

  // resizable split
  (function splitter() {
    const divider = $('divider');
    const left = $('paneLeft');
    const split = $('split');
    const setPct = (p) => {
      p = Math.max(20, Math.min(80, p));
      left.style.flexBasis = p + '%';
      try { localStorage.setItem(SPLIT_KEY, String(p)); } catch (e) { /* ignore */ }
    };
    try {
      const p = parseFloat(localStorage.getItem(SPLIT_KEY));
      if (p) left.style.flexBasis = p + '%';
    } catch (e) { /* ignore */ }
    let active = false;
    divider.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || window.matchMedia('(max-width: 860px)').matches) return;
      active = true;
      divider.classList.add('dragging');
      divider.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    divider.addEventListener('pointermove', (e) => {
      if (!active) return;
      const rect = split.getBoundingClientRect();
      setPct(((e.clientX - rect.left) / rect.width) * 100);
    });
    const stop = () => { active = false; divider.classList.remove('dragging'); };
    divider.addEventListener('pointerup', stop);
    divider.addEventListener('pointercancel', stop);
    divider.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const cur = parseFloat(left.style.flexBasis) || 58;
      setPct(cur + (e.key === 'ArrowLeft' ? -2 : 2));
    });
  })();

  // ---------------------------------------------------------------- boot

  load();
  syncWidthUI();
  render();
  convert();
})();
