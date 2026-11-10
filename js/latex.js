/*
 * Table2Latex: LaTeX generator.
 * Pure function of the table model; no DOM access. Exposed as window.Table2Latex.
 *
 * Model:
 *   rows, cols          grid size
 *   cells[r][c]         { t: text, b: bold, i: italic, a: 'l'|'c'|'r'|null (override) }
 *   colSpec[c]          column spec string, e.g. 'c', 'l', 'p{3cm}', 'S'
 *   merges[]            { r, c, rs, cs } rectangular merged regions (top-left is the anchor)
 *   headerRows          number of leading header rows
 */
(function (global) {
  'use strict';

  const ESC = {
    '\\': '\\textbackslash{}',
    '&': '\\&',
    '%': '\\%',
    '#': '\\#',
    '_': '\\_',
    '{': '\\{',
    '}': '\\}',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}',
    '$': '\\$',
  };

  // Escape LaTeX specials outside $...$ math segments.
  function escapeText(s) {
    return s
      .split(/(\$[^$]+\$)/g)
      .map((seg, i) => (i % 2 ? seg : seg.replace(/[\\&%#_{}~^$]/g, (ch) => ESC[ch])))
      .join('');
  }

  // owner[r][c] -> merge covering that cell, or null
  function buildOwner(model) {
    const owner = Array.from({ length: model.rows }, () => new Array(model.cols).fill(null));
    for (const m of model.merges) {
      for (let r = m.r; r < m.r + m.rs; r++) {
        for (let c = m.c; c < m.c + m.cs; c++) owner[r][c] = m;
      }
    }
    return owner;
  }

  function cleanSpec(spec, stripBars) {
    let s = (spec || '').trim();
    if (stripBars) s = s.replace(/\|/g, '');
    return s || 'c';
  }

  // Single-letter alignment usable inside \multicolumn
  function baseAlign(spec) {
    const m = /^[|\s]*([lcr])/.exec(spec);
    return m ? m[1] : 'c';
  }

  function generate(model, opts) {
    const o = Object.assign(
      {
        style: 'booktabs', // booktabs | grid | hlines | plain
        float: 'htbp',
        size: '',
        caption: '',
        label: '',
        capPos: 'top',
        env: true,
        center: true,
        resize: false,
        boldHeader: true,
        escape: true,
        cmidrule: true,
        alignAmp: true,
      },
      opts || {}
    );

    const R = model.rows;
    const C = model.cols;
    const H = Math.min(Math.max(model.headerRows | 0, 0), R);
    const grid = o.style === 'grid';
    const owner = buildOwner(model);
    const pkgs = new Set();
    if (o.style === 'booktabs') pkgs.add('booktabs');

    const specs = [];
    for (let c = 0; c < C; c++) specs.push(cleanSpec(model.colSpec[c], grid));
    const tabSpec = grid ? '|' + specs.join('|') + '|' : specs.join('');
    if (specs.some((s) => /^S/.test(s))) pkgs.add('siunitx');
    if (specs.some((s) => /^[mb]\{/.test(s))) pkgs.add('array');

    const fmt = (r, c) => {
      const cell = model.cells[r][c];
      let raw = (cell.t || '').replace(/\r/g, '').replace(/\n+$/, '');
      if (!raw.trim()) return '';
      const lines = raw.split('\n').map((l) => (o.escape ? escapeText(l.trim()) : l.trim()));
      let s;
      if (lines.length > 1) {
        pkgs.add('makecell');
        s = '\\makecell{' + lines.join(' \\\\ ') + '}';
      } else {
        s = lines[0];
      }
      if (cell.i) s = '\\textit{' + s + '}';
      if (cell.b || (o.boldHeader && r < H)) s = '\\textbf{' + s + '}';
      return s;
    };

    const mcSpec = (c, cs, a) => {
      if (!grid) return a;
      return (c === 0 ? '|' : '') + a + '|';
    };

    // Build row parts: [{ text, c, cs }]
    const rowsParts = [];
    for (let r = 0; r < R; r++) {
      const parts = [];
      let c = 0;
      while (c < C) {
        const m = owner[r][c];
        if (m) {
          const cs = m.cs;
          const anchorCell = model.cells[m.r][m.c];
          const a = anchorCell.a || baseAlign(specs[m.c]);
          let text = '';
          if (m.r === r) {
            text = fmt(m.r, m.c);
            if (m.rs > 1) {
              pkgs.add('multirow');
              text = '\\multirow{' + m.rs + '}{*}{' + text + '}';
            }
          }
          if (cs > 1 || (m.r === r && anchorCell.a && anchorCell.a !== baseAlign(specs[m.c]))) {
            text = '\\multicolumn{' + cs + '}{' + mcSpec(c, cs, a) + '}{' + text + '}';
          }
          parts.push({ text, c, cs });
          c += cs;
          continue;
        }
        const cell = model.cells[r][c];
        let text = fmt(r, c);
        const base = baseAlign(specs[c]);
        if (cell.a && (cell.a !== base || !/^[lcr]$/.test(specs[c]))) {
          text = '\\multicolumn{1}{' + mcSpec(c, 1, cell.a) + '}{' + text + '}';
        } else if (/^S/.test(specs[c]) && text && r < H) {
          text = '{' + text + '}'; // siunitx: protect non-numeric header text
        }
        parts.push({ text, c, cs: 1 });
        c++;
      }
      rowsParts.push(parts);
    }

    // Column widths for aligned '&' output
    const widths = new Array(C).fill(0);
    if (o.alignAmp) {
      for (const parts of rowsParts) {
        for (const p of parts) if (p.cs === 1) widths[p.c] = Math.max(widths[p.c], p.text.length);
      }
      for (const parts of rowsParts) {
        for (const p of parts) {
          if (p.cs === 1) continue;
          let span = 3 * (p.cs - 1);
          for (let k = p.c; k < p.c + p.cs; k++) span += widths[k];
          if (p.text.length > span) widths[p.c + p.cs - 1] += p.text.length - span;
        }
      }
    }
    const pad = (p) => {
      if (!o.alignAmp) return p.text;
      let w = 3 * (p.cs - 1);
      for (let k = p.c; k < p.c + p.cs; k++) w += widths[k];
      return p.text.padEnd(w, ' ');
    };

    // Horizontal rule between row r and r+1, respecting multirow cells that cross it.
    const ruleBetween = (r, cmd) => {
      const free = [];
      for (let c = 0; c < C; c++) {
        const m = owner[r][c];
        free.push(!(m && m.r <= r && m.r + m.rs - 1 > r));
      }
      if (free.every(Boolean)) return cmd === 'hline' ? '\\hline' : '\\' + cmd;
      const segs = [];
      let start = -1;
      for (let c = 0; c <= C; c++) {
        if (c < C && free[c]) {
          if (start < 0) start = c;
        } else if (start >= 0) {
          segs.push([start + 1, c]);
          start = -1;
        }
      }
      if (!segs.length) return '';
      if (cmd === 'hline') return segs.map(([a, b]) => '\\cline{' + a + '-' + b + '}').join(' ');
      return segs.map(([a, b]) => '\\cmidrule{' + a + '-' + b + '}').join(' ');
    };

    const body = [];
    const ind = o.env ? '  ' : '';
    const ind2 = ind + '  ';
    const lined = o.style === 'grid' || o.style === 'hlines';

    if (o.style === 'booktabs') body.push(ind2 + '\\toprule');
    else if (lined) body.push(ind2 + '\\hline');

    for (let r = 0; r < R; r++) {
      const line = rowsParts[r].map(pad).join(' & ');
      body.push(ind2 + line.replace(/\s+$/, '') + ' \\\\');
      const last = r === R - 1;
      if (o.style === 'booktabs') {
        if (last) body.push(ind2 + '\\bottomrule');
        else if (r === H - 1) body.push(ind2 + ruleBetween(r, 'midrule'));
        else if (r < H - 1 && o.cmidrule) {
          // \cmidrule under grouped header cells that end on this row
          const segs = model.merges
            .filter((m) => m.cs > 1 && m.r + m.rs - 1 === r)
            .sort((a, b) => a.c - b.c)
            .map((m) => '\\cmidrule(lr){' + (m.c + 1) + '-' + (m.c + m.cs) + '}');
          if (segs.length) body.push(ind2 + segs.join(' '));
        }
      } else if (lined) {
        if (last) body.push(ind2 + '\\hline');
        else if (grid || r === H - 1 || o.style === 'hlines') {
          const rule = ruleBetween(r, 'hline');
          if (rule) body.push(ind2 + rule);
        }
      }
    }

    const out = [];
    const capLines = [];
    if (o.env) {
      if (o.caption) capLines.push(ind + '\\caption{' + (o.escape ? escapeText(o.caption) : o.caption) + '}');
      if (o.label) capLines.push(ind + '\\label{' + o.label + '}');
    }

    if (o.env) out.push('\\begin{table}' + (o.float ? '[' + o.float + ']' : ''));
    if (o.env && o.center) out.push(ind + '\\centering');
    if (o.env && o.capPos === 'top') out.push(...capLines);
    if (o.size) out.push(ind + o.size);
    if (o.resize) {
      pkgs.add('graphicx');
      out.push(ind + '\\resizebox{\\textwidth}{!}{%');
    }
    out.push(ind + '\\begin{tabular}{' + tabSpec + '}');
    out.push(...body);
    out.push(ind + '\\end{tabular}' + (o.resize ? '%' : ''));
    if (o.resize) out.push(ind + '}');
    if (o.env && o.capPos === 'bottom') out.push(...capLines);
    if (o.env) out.push('\\end{table}');

    const order = ['booktabs', 'multirow', 'makecell', 'siunitx', 'array', 'graphicx'];
    const packages = order.filter((p) => pkgs.has(p));
    let code = out.join('\n');
    if (packages.length) {
      code = '% Requires in preamble: ' + packages.map((p) => '\\usepackage{' + p + '}').join(' ') + '\n' + code;
    }
    return { code, packages };
  }

  global.Table2Latex = { generate, escapeText };
})(typeof window !== 'undefined' ? window : globalThis);
