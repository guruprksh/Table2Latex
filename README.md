# Table2Latex

Design a table visually, then convert it to LaTeX with one click.

The window is split in two. On the left you build the table: headers, merged cells, alignment and bold/italic text. On the right is the LaTeX code, ready to copy into your paper.

It runs entirely in the browser, with no build step, no dependencies and no server.

## Features

- **Spreadsheet-like editor**: click a cell and type. Tab and Enter move between cells.
- **Merge cells**: drag to select a block, then press **Merge** (Ctrl+M).
  - Horizontal merges become `\multicolumn`.
  - Vertical merges become `\multirow`.
  - Merges can be both at once.
- **Header rows**: choose how many leading rows are the header. Header cells can be bolded automatically.
- **Rows and columns**: insert and delete them. Merged regions adjust automatically.
- **Column specs**: each column takes any spec: `l`, `c`, `r`, `p{3cm}`, `S` (siunitx), and so on.
- **Per-cell formatting**: bold, italic and an alignment override, which is emitted as `\multicolumn{1}{…}`.
- **Table styles**:
  - booktabs (`\toprule`, `\midrule`, `\bottomrule`, plus `\cmidrule` under grouped headers)
  - full grid
  - horizontal lines only
  - no lines
- **Correct rules around multirow cells**: lines between rows use `\cline` or `\cmidrule` segments, so they never cut through a `\multirow` cell.
- **Escaping**: `& % _ # { } ~ ^ \` are escaped automatically. Text inside `$…$` is left alone as math.
- **Multi-line cells**: press Shift+Enter inside a cell. The cell is wrapped in `\makecell`.
- **Table wrapper**: a `table` environment with caption (above or below), label, float placement, font size, `\centering` and an optional `\resizebox{\textwidth}`.
- **Import**: paste cells straight from Excel or Google Sheets, or load a CSV/TSV file.
- **Copy and save**: copy to the clipboard, download a `.tex` file, or save and load the project as `.json`.
- **Autosave and undo**: your work is saved in the browser. Undo and redo are available.
- **Required packages**: listed in a comment at the top of the output.

## Run locally

Open `index.html` in any modern browser. That's it.

## Host on GitHub Pages

1. Create a new repository on GitHub, for example `Table2Latex`.
2. Push this folder to it:

   ```bash
   cd Table2Latex
   git init
   git add .
   git commit -m "Table2Latex: visual table designer with LaTeX export"
   git branch -M main
   git remote add origin https://github.com/<your-username>/Table2Latex.git
   git push -u origin main
   ```

3. On GitHub, go to **Settings → Pages**.
4. Under **Build and deployment**, set:
   - **Source**: *Deploy from a branch*
   - **Branch**: `main`
   - **Folder**: `/ (root)`

   Then click **Save**.
5. After a minute the site is live at `https://<your-username>.github.io/Table2Latex/`.

## Files

```
index.html     page layout (split window, toolbar, dialogs)
css/style.css  styling, including dark mode and a stacked layout on narrow screens
js/latex.js    LaTeX generator (pure function of the table model)
js/app.js      editor: selection, merging, row/column ops, undo, import/export
.nojekyll      tells GitHub Pages to serve the files as-is
```

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Tab / Shift+Tab | next / previous cell (Tab in the last cell adds a row) |
| Enter, ↑ / ↓ | move down / up |
| Shift+Enter | line break inside a cell |
| Shift+click, drag | select a block of cells |
| Ctrl+M | merge selection |
| Ctrl+B / Ctrl+I | bold / italic |
| Delete | clear the selected cells |
| Ctrl+Z / Ctrl+Y | undo / redo |
| Ctrl+Enter | convert to LaTeX |
