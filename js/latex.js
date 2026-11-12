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

  // Header must include every row reached by a merge that starts inside it.
  function effectiveHeaderRows(model) {
    let H = Math.min(Math.max(model.headerRows | 0, 0), model.rows);
    let grown = true;
    while (grown) {
      grown = false;
      for (const m of model.merges) {
        if (m.r < H && m.r + m.rs > H) {
          H = m.r + m.rs;
          grown = true;
        }
      }
    }
    return H;
  }

  // Rough printed length of cell text in characters (markup and math syntax removed).
  function visibleText(t) {
    return (t || '')
      .replace(/\$([^$]*)\$/g, (_, s) => s.replace(/\\[a-zA-Z]+/g, '').replace(/[\s{}^_]/g, ''))
      .replace(/\\[a-zA-Z]+\*?/g, '')
      .replace(/[{}\\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // tabularx column weights: relative width each plain l/c/r column needs so that
  // header text can wrap (up to ~3 lines) and body text stays on one line.
  // Returns an array of weights (null for non-X columns) that sum to the X column count.
  function xWeights(model, specs, H, owner) {
    const C = model.cols;
    const isX = specs.map((s) => /^[lcr]$/.test(s));
    const nX = isX.filter(Boolean).length;
    if (!nX) return null;
    const MIN = 3;
    const GAP = 2; // inter-column padding, in characters
    const need = new Array(C).fill(MIN);
    const measure = (r, c, lines) => {
      const text = visibleText(model.cells[r][c].t);
      if (!text) return 0;
      const longest = Math.max(...text.split(/\s+|(?<=-)/).map((w) => w.length));
      return Math.max(longest, Math.ceil(text.length / lines));
    };
    const spans = [];
    for (let r = 0; r < model.rows; r++) {
      for (let c = 0; c < C; c++) {
        const m = owner[r][c];
        if (m && (m.r !== r || m.c !== c)) continue;
        const cs = m ? m.cs : 1;
        const lines = r < H ? (m && m.rs > 1 ? 2 * m.rs : 3) : 1;
        if (cs === 1) need[c] = Math.max(need[c], measure(r, c, lines));
        else spans.push({ c, cs, req: measure(r, c, r < H ? 2 : 1) });
      }
    }
    // widen spanned columns when a grouped header needs more room than they give
    spans.sort((a, b) => a.cs - b.cs);
    for (const s of spans) {
      let have = GAP * (s.cs - 1);
      for (let k = s.c; k < s.c + s.cs; k++) have += need[k];
      if (s.req > have) for (let k = s.c; k < s.c + s.cs; k++) need[k] += (s.req - have) / s.cs;
    }
    const xs = need.filter((_, c) => isX[c]);
    const mean = xs.reduce((a, b) => a + b, 0) / nX;
    const w = need.map((n, c) => (isX[c] ? Math.round((n / mean) * 100) / 100 : null));
    // make the rounded weights sum exactly to nX
    const sum = w.reduce((a, b) => a + (b || 0), 0);
    const big = w.indexOf(Math.max(...w.filter((x) => x !== null)));
    w[big] = Math.round((w[big] + nX - sum) * 100) / 100;
    return w;
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
        widthMode: 'natural', // natural | stretch | tabularx | shrink | scale
        width: '\\textwidth',
        colSep: '',
        stretch: '',
        vspace: '',
        span: false,
        boldHeader: true,
        escape: true,
        cmidrule: true,
        alignAmp: true,
      },
      opts || {}
    );

    const R = model.rows;
    const C = model.cols;
    const H = effectiveHeaderRows(model);
    const grid = o.style === 'grid';
    const owner = buildOwner(model);
    const pkgs = new Set();
    if (o.style === 'booktabs') pkgs.add('booktabs');

    const specs = [];
    for (let c = 0; c < C; c++) specs.push(cleanSpec(model.colSpec[c], grid));
    const tabSpec = grid ? '|' + specs.join('|') + '|' : specs.join('');
    if (specs.some((s) => /^S/.test(s))) pkgs.add('siunitx');
    if (specs.some((s) => /^[mb]\{/.test(s))) pkgs.add('array');

    // tabularx: weighted X columns (skipped if the user already wrote X columns)
    const xw = o.widthMode === 'tabularx' && !specs.some((s) => /X/.test(s)) ? xWeights(model, specs, H, owner) : null;
    const ALIGN_CMD = { l: '\\raggedright', c: '\\centering', r: '\\raggedleft' };
    const allX = (c, cs) => {
      if (!xw) return false;
      for (let k = c; k < c + cs; k++) if (xw[k] === null) return false;
      return true;
    };
    const xSpec = (c, cs, a) => {
      let w = 0;
      for (let k = c; k < c + cs; k++) w += xw[k];
      w = Math.round(w * 100) / 100;
      let hs = '';
      if (cs > 1) {
        hs = '\\hsize=\\dimexpr' + w + '\\hsize+' + 2 * (cs - 1) + '\\tabcolsep' +
          (grid ? '+' + (cs - 1) + '\\arrayrulewidth' : '') + '\\relax';
      } else if (w !== 1) {
        hs = '\\hsize=' + w + '\\hsize';
      }
      return '>{' + hs + ALIGN_CMD[a] + '\\arraybackslash}X';
    };

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
      const s = allX(c, cs) ? xSpec(c, cs, a) : a;
      if (!grid) return s;
      return (c === 0 ? '|' : '') + s + '|';
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
              // inside X columns the multirow text wraps to the column width
              text = allX(m.c, cs)
                ? '\\multirow{' + m.rs + '}{\\linewidth}{' + (text ? ALIGN_CMD[a] + ' ' + text : '') + '}'
                : '\\multirow{' + m.rs + '}{*}{' + text + '}';
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
    // aligning very wide tables makes the code harder to read, not easier
    const align = o.alignAmp && widths.reduce((a, b) => a + b, 0) + 3 * (C - 1) <= 220;
    const pad = (p) => {
      if (!align) return p.text;
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
      // caption is raw LaTeX so \cite{...}, $...$ etc. work
      if (o.caption) capLines.push(ind + '\\caption{' + o.caption + '}');
      if (o.label) capLines.push(ind + '\\label{' + o.label + '}');
    }

    // Width handling
    const W = (o.width || '').trim() || '\\textwidth';
    let tabEnv = 'tabular';
    let tabArgs = '{' + tabSpec + '}';
    let wrapOpen = null;
    let wrapClose = null;
    if (o.widthMode === 'stretch') {
      // natural column widths, extra space distributed between columns
      tabEnv = 'tabular*';
      tabArgs = '{' + W + '}{@{\\extracolsep{\\fill}}' + tabSpec + '}';
    } else if (o.widthMode === 'tabularx') {
      // plain l/c/r columns become weighted X columns that share the width (unless the user already placed X)
      pkgs.add('tabularx');
      tabEnv = 'tabularx';
      const xSpecs = xw ? specs.map((s, c) => (xw[c] === null ? s : xSpec(c, 1, s))) : specs;
      if (xSpecs.some((s) => s.startsWith('>'))) pkgs.add('array');
      tabArgs = '{' + W + '}{' + (grid ? '|' + xSpecs.join('|') + '|' : xSpecs.join('')) + '}';
    } else if (o.widthMode === 'shrink') {
      pkgs.add('adjustbox');
      wrapOpen = '\\begin{adjustbox}{max width=' + W + '}';
      wrapClose = '\\end{adjustbox}';
    } else if (o.widthMode === 'scale') {
      pkgs.add('graphicx');
      wrapOpen = '\\resizebox{' + W + '}{!}{%';
      wrapClose = '}';
    }

    const envName = o.span ? 'table*' : 'table';
    if (o.env) out.push('\\begin{' + envName + '}' + (o.float ? '[' + o.float + ']' : ''));
    if (o.env && o.vspace) out.push(ind + '\\vspace{' + o.vspace + '}');
    if (o.env && o.center) out.push(ind + '\\centering');
    if (o.env && o.capPos === 'top') out.push(...capLines);
    if (o.size) out.push(ind + o.size);
    if (o.colSep) out.push(ind + '\\setlength{\\tabcolsep}{' + o.colSep + '}');
    if (o.stretch) out.push(ind + '\\renewcommand{\\arraystretch}{' + o.stretch + '}');
    if (wrapOpen) out.push(ind + wrapOpen);
    out.push(ind + '\\begin{' + tabEnv + '}' + tabArgs);
    out.push(...body);
    out.push(ind + '\\end{' + tabEnv + '}' + (o.widthMode === 'scale' ? '%' : ''));
    if (wrapClose) out.push(ind + wrapClose);
    if (o.env && o.capPos === 'bottom') out.push(...capLines);
    if (o.env) out.push('\\end{' + envName + '}');

    const order = ['booktabs', 'multirow', 'makecell', 'siunitx', 'array', 'tabularx', 'adjustbox', 'graphicx'];
    const packages = order.filter((p) => pkgs.has(p));
    let code = out.join('\n');
    if (packages.length) {
      code = '% Requires in preamble: ' + packages.map((p) => '\\usepackage{' + p + '}').join(' ') + '\n' + code;
    }
    return { code, packages };
  }

  global.Table2Latex = { generate, escapeText, effectiveHeaderRows };
})(typeof window !== 'undefined' ? window : globalThis);
