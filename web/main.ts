import type ExcelJS from 'exceljs';
// @ts-expect-error virtual module provided by scripts/build-web.ts
import specs from 'virtual:specs';
// @ts-expect-error virtual module provided by scripts/build-web.ts
import samples from 'virtual:samples';
import {
  SpecRegistry,
  setDefaultRegistry,
  ediToExcel,
  excelToEdi,
  serializeSegment,
  formatIssue,
  SERVICE_SEGMENTS,
  type EdiToExcelResult,
  type Issue,
  type GroupInstance,
  type StructureNode,
  type Delimiters,
} from '../src/index';
import { cellText } from '../src/excel/read';
import { decodeInterchange, serializeInterchange } from '../src/edifact/syntax';

const registry = new SpecRegistry(specs);
setDefaultRegistry(registry);

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Array<Node | string>): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) e.append(c);
  return e;
}
const download = (data: Uint8Array, name: string, type: string) => {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ---------------------------------------------------------------- tabs
document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll<HTMLElement>('.panel').forEach((p) => (p.hidden = p.id !== b.dataset.tab));
  }),
);

// ---------------------------------------------------------------- shared rendering
function renderIssues(list: HTMLElement, issues: Issue[]): void {
  list.replaceChildren();
  if (!issues.length) {
    list.append(el('li', { class: 'none' }, '✓ No issues: structure, data elements and control counts conform to the specification.'));
    return;
  }
  for (const i of issues) {
    const text = formatIssue(i);
    const m = /^(\w+) (\w+)(.*)$/.exec(text);
    list.append(el('li', { class: i.severity }, el('span', { class: 'code' }, m ? `${m[1]} ${m[2]}` : i.code), m ? m[3] : ''));
  }
}

function chips(target: HTMLElement, items: Array<[string, string?]>): void {
  target.classList.remove('muted');
  target.replaceChildren(...items.map(([t, c]) => el('span', { class: `chip ${c ?? ''}` }, t)));
}

function errorNotice(target: HTMLElement, e: unknown): void {
  const err = e as Error & { issues?: Issue[] };
  const detail = err.issues?.length ? `\n${err.issues.slice(0, 10).map(formatIssue).join('\n')}` : '';
  target.replaceChildren(el('div', { class: 'notice err' }, `${err.name ?? 'Error'}: ${err.message}${detail}`));
}

// ---------------------------------------------------------------- EDI -> Excel
const ediInput = $<HTMLTextAreaElement>('edi-input');
const sampleSel = $<HTMLSelectElement>('sample');
sampleSel.append(el('option', { value: '' }, 'Load a sample…'));
for (const s of samples as Array<{ name: string; text: string }>) sampleSel.append(el('option', { value: s.name }, s.name.replace('.edi', '').replace('_', ' ')));
sampleSel.addEventListener('change', () => {
  const s = (samples as Array<{ name: string; text: string }>).find((x) => x.name === sampleSel.value);
  if (s) {
    ediInput.value = s.text;
    void convert();
  }
});
const dirOverride = $<HTMLSelectElement>('dir-override');
for (const d of registry.directories()) dirOverride.append(el('option', { value: d }, d));

$<HTMLInputElement>('edi-file').addEventListener('change', async (ev) => {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  // Decoded the same way as the library does (ISO 8859-1 unless UNB declares UNOW/UNOY).
  ediInput.value = decodeInterchange(bytes);
  sampleSel.value = '';
  void convert();
});

let last: EdiToExcelResult | undefined;
let lastName = 'interchange';

async function convert(): Promise<void> {
  const summary = $('summary');
  $('roundtrip-result').replaceChildren();
  try {
    const r = await ediToExcel(ediInput.value, {
      allSegments: $<HTMLInputElement>('all-segments').checked,
      directory: dirOverride.value || undefined,
    });
    last = r;
    lastName = sampleSel.value ? sampleSel.value.replace('.edi', '') : r.analysis.messages[0]?.type ?? 'interchange';
    const errors = r.issues.filter((i) => i.severity === 'error').length;
    const warnings = r.issues.length - errors;
    const types = [...new Set(r.analysis.messages.map((m) => `${m.type} ${m.def.version}:${m.def.release}`))];
    chips(summary, [
      ...types.map((t) => [t] as [string]),
      [`${r.analysis.messages.length} message${r.analysis.messages.length === 1 ? '' : 's'}`],
      [`${r.workbook.worksheets.length} sheets`],
      errors ? [`${errors} error${errors === 1 ? '' : 's'}`, 'err'] : ['valid', 'ok'],
      ...(warnings ? [[`${warnings} warning${warnings === 1 ? '' : 's'}`, 'warn'] as [string, string]] : []),
    ]);
    renderIssues($('issues'), r.issues);
    renderTree(r);
    renderWorkbook(r.workbook);
    ($<HTMLButtonElement>('download-xlsx')).disabled = false;
    ($<HTMLButtonElement>('roundtrip')).disabled = false;
    ($<HTMLButtonElement>('use-last')).disabled = false;
  } catch (e) {
    last = undefined;
    errorNotice(summary, e);
    $('issues').replaceChildren();
    $('tree').replaceChildren();
    $('sheet-tabs').replaceChildren();
    $('sheet').replaceChildren(el('p', { class: 'muted pad' }, 'No workbook.'));
    ($<HTMLButtonElement>('download-xlsx')).disabled = true;
    ($<HTMLButtonElement>('roundtrip')).disabled = true;
  }
}
$('convert').addEventListener('click', () => void convert());
$('all-segments').addEventListener('change', () => last && void convert());
dirOverride.addEventListener('change', () => ediInput.value && void convert());
$('download-xlsx').addEventListener('click', () => {
  if (last) download(last.xlsx, `${lastName}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

$('roundtrip').addEventListener('click', async () => {
  if (!last) return;
  const out = $('roundtrip-result');
  try {
    const back = await excelToEdi(last.xlsx);
    const canonical = serializeInterchange(last.analysis.interchange);
    if (back.edi === canonical) {
      out.replaceChildren(
        el('div', { class: 'notice ok' }, `✓ Excel → EDI reproduces the interchange exactly (${back.edi.length.toLocaleString()} characters${back.edi === ediInput.value ? ', byte-identical to the input' : ', identical to its canonical form'}).`),
      );
    } else {
      const a = canonical.split(/\r?\n|'/);
      const b = back.edi.split(/\r?\n|'/);
      const k = a.findIndex((x, i) => x !== b[i]);
      out.replaceChildren(el('div', { class: 'notice err' }, `Round trip differs at segment ${k + 1}:\n  input:  ${a[k]}\n  output: ${b[k]}`));
    }
  } catch (e) {
    errorNotice(out, e);
  }
});

function renderTree(r: EdiToExcelResult): void {
  const tree = $('tree');
  tree.replaceChildren();
  const d: Delimiters = r.analysis.interchange.delimiters;
  const segLine = (s: Parameters<typeof serializeSegment>[0], meta: string) => {
    const text = serializeSegment(s, d);
    return el('div', { class: 'seg', title: text }, el('span', { class: 'tag' }, s.tag), text.slice(3), el('span', { class: 'meta' }, `  ${meta}`));
  };
  let budget = 3000;
  const walk = (inst: GroupInstance, parent: HTMLElement, depth: number) => {
    for (const e of inst.entries) {
      if (budget-- <= 0) return;
      if (e.kind === 'segment') {
        parent.append(segLine(e.segment, `${e.node.pos} ${e.node.name}`));
      } else {
        const det = el('details');
        if (depth < 1) det.open = true;
        const g = e.node;
        det.append(
          el('summary', {}, `${e.instance.path}  `, el('span', { class: 'meta' }, `${g.children.map((c) => (c.kind === 'segment' ? c.tag : c.id)).join('-')}`)),
        );
        walk(e.instance, det, depth + 1);
        parent.append(det);
      }
    }
  };
  for (const m of r.analysis.messages) {
    const det = el('details');
    det.open = true;
    det.append(el('summary', {}, `M${m.index} ${m.type} ${m.def.version}:${m.def.release} — ${m.def.name}`));
    walk(m.tree.root, det, 0);
    tree.append(det);
  }
  if (budget <= 0) tree.append(el('div', { class: 'meta' }, '… (truncated)'));
}

function renderWorkbook(wb: ExcelJS.Workbook): void {
  const tabs = $('sheet-tabs');
  tabs.replaceChildren();
  const sheets = wb.worksheets;
  const show = (ws: ExcelJS.Worksheet) => {
    tabs.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.textContent === ws.name)));
    renderSheet(ws);
  };
  for (const ws of sheets) {
    const b = el('button', { role: 'tab', 'aria-selected': 'false' }, ws.name);
    b.addEventListener('click', () => show(ws));
    tabs.append(b);
  }
  // Start on the segment group sheet with the most rows (e.g. the equipment in a BAPLIE).
  const groups = sheets.filter((s) => /SG\d+$/.test(s.name)).sort((a, b) => b.rowCount - a.rowCount);
  show(groups[0] ?? sheets.find((s) => s.name !== 'Info') ?? sheets[0]);
}

function renderSheet(ws: ExcelJS.Worksheet): void {
  const host = $('sheet');
  const cols = ws.columnCount;
  const isTable = cellText(ws.getRow(2).getCell(1).value) === 'Path';
  const table = el('table');
  const MAX = 500;
  if (isTable) {
    const thead = el('thead');
    const cap = el('tr');
    const head = el('tr');
    // Row 1: merged segment captions (consecutive identical master cells).
    let c = 1;
    let block = 0;
    while (c <= cols) {
      const cell = ws.getRow(1).getCell(c);
      const master = cell.isMerged ? cell.master : cell;
      let span = 1;
      while (c + span <= cols && ws.getRow(1).getCell(c + span).isMerged && ws.getRow(1).getCell(c + span).master.address === master.address) span++;
      const text = c === 1 ? '' : cellText(master.value);
      cap.append(el('th', { colspan: String(span), class: `${c === 1 ? 'path ' : ''}${text ? (block++ % 2 ? 'cap-b' : 'cap-a') : 'cap-0'}` }, text));
      c += span;
    }
    for (let i = 1; i <= cols; i++) {
      const cell = ws.getRow(2).getCell(i);
      const th = el('th', i === 1 ? { class: 'path' } : {}, cellText(cell.value));
      const note = cell.note;
      if (note) th.title = typeof note === 'string' ? note : note.texts?.map((t) => t.text).join('') ?? '';
      head.append(th);
    }
    thead.append(cap, head);
    table.append(thead);
  }
  const tbody = el('tbody');
  const first = isTable ? 3 : 1;
  for (let r = first; r <= Math.min(ws.rowCount, first + MAX - 1); r++) {
    const tr = el('tr');
    for (let i = 1; i <= cols; i++) {
      const v = cellText(ws.getRow(r).getCell(i).value);
      tr.append(el('td', i === 1 && isTable ? { class: 'path' } : {}, v));
    }
    tbody.append(tr);
  }
  table.append(tbody);
  host.replaceChildren(table);
  if (ws.rowCount - first + 1 > MAX) host.append(el('div', { class: 'more muted' }, `Showing ${MAX} of ${ws.rowCount - first + 1} rows. Download the workbook for all rows.`));
}

// ---------------------------------------------------------------- Excel -> EDI
let lastEdi: { bytes: Uint8Array; name: string } | undefined;
async function convertWorkbook(data: Uint8Array, name: string): Promise<void> {
  const summary = $('edi-summary');
  try {
    const r = await excelToEdi(data, { recalculateControls: $<HTMLInputElement>('recalc').checked });
    $<HTMLTextAreaElement>('edi-output').value = r.edi;
    lastEdi = { bytes: r.bytes, name: name.replace(/\.xlsx$/i, '') + '.edi' };
    const errors = r.issues.filter((i) => i.severity === 'error').length;
    chips(summary, [
      [name],
      [`${r.analysis.messages.length} message${r.analysis.messages.length === 1 ? '' : 's'}`],
      [`${r.analysis.interchange.messages.reduce((n, m) => n + m.segments.length, 0)} message segments`],
      errors ? [`${errors} error${errors === 1 ? '' : 's'}`, 'err'] : ['valid', 'ok'],
    ]);
    renderIssues($('edi-issues'), r.issues);
    $<HTMLButtonElement>('download-edi').disabled = false;
  } catch (e) {
    errorNotice(summary, e);
    $<HTMLTextAreaElement>('edi-output').value = '';
    $('edi-issues').replaceChildren();
    $<HTMLButtonElement>('download-edi').disabled = true;
  }
}
const drop = $('drop');
const readXlsx = async (f: File | undefined) => {
  if (f) await convertWorkbook(new Uint8Array(await f.arrayBuffer()), f.name);
};
$<HTMLInputElement>('xlsx-file').addEventListener('change', (ev) => void readXlsx((ev.target as HTMLInputElement).files?.[0]));
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  void readXlsx(e.dataTransfer?.files?.[0]);
});
$('use-last').addEventListener('click', () => last && void convertWorkbook(last.xlsx, `${lastName}.xlsx`));
$('download-edi').addEventListener('click', () => lastEdi && download(lastEdi.bytes, lastEdi.name, 'application/edifact'));

// ---------------------------------------------------------------- spec browser
const specDir = $<HTMLSelectElement>('spec-dir');
const specMsg = $<HTMLSelectElement>('spec-msg');
for (const d of registry.directories()) specDir.append(el('option', { value: d }, `Directory ${d.slice(0, 1)}.${d.slice(1)}`));
specDir.value = 'D21B';
const fillMessages = () => {
  const keep = specMsg.value || 'BAPLIE';
  specMsg.replaceChildren(...registry.messageTypes(specDir.value).map((t) => el('option', { value: t }, `${t} — ${registry.message(specDir.value, t).name}`)));
  specMsg.value = registry.messageTypes(specDir.value).includes(keep) ? keep : registry.messageTypes(specDir.value)[0];
  renderSpec();
};
specDir.addEventListener('change', fillMessages);
specMsg.addEventListener('change', renderSpec);

function renderSpec(): void {
  const def = registry.message(specDir.value, specMsg.value);
  $('spec-head').replaceChildren(
    el('p', { class: 'spec-def' }, el('strong', {}, `${def.type} ${def.version}:${def.release}:${def.agency}`), ` — ${def.name}`, def.revision ? el('span', { class: 'muted' }, ` (revision ${def.revision}, ${def.date ?? ''})`) : ''),
    el('p', { class: 'muted small' }, def.functionalDefinition ?? ''),
  );
  const tree = $('spec-tree');
  tree.replaceChildren();
  const walk = (nodes: StructureNode[], parent: HTMLElement) => {
    for (const n of nodes) {
      if (n.kind === 'segment') {
        const line = el('div', { class: 'seg' }, `${n.pos}  `, el('span', { class: 'tag' }, n.tag), ` ${n.name}  `, el('span', { class: 'meta' }, `${n.status} ${n.maxRepeat}`));
        line.addEventListener('click', () => {
          tree.querySelectorAll('.seg.sel').forEach((x) => x.classList.remove('sel'));
          line.classList.add('sel');
          renderSegment(def.directory, n.tag);
        });
        parent.append(line);
      } else {
        const det = el('details');
        det.open = true;
        det.append(el('summary', {}, `${n.pos}  Segment group ${n.id.slice(2)}  `, el('span', { class: 'meta' }, `${n.status} ${n.maxRepeat}`)));
        walk(n.children, det);
        parent.append(det);
      }
    }
  };
  walk(def.children, tree);
  renderSegment(def.directory, 'EQD');
}

function renderSegment(directory: string, tag: string): void {
  const seg = SERVICE_SEGMENTS[tag] ?? registry.segment(directory, tag);
  if (!seg) return;
  $('seg-title').textContent = `${seg.tag} — ${seg.name}${SERVICE_SEGMENTS[tag] ? ' (ISO 9735 service segment)' : ''}`;
  const t = el('table', { class: 'elements' }, el('thead', {}, el('tr', {}, el('th', {}, 'Pos'), el('th', {}, 'Tag'), el('th', {}, 'Name'), el('th', {}, 'S'), el('th', {}, 'R'), el('th', {}, 'Repr.'))));
  const tb = el('tbody');
  for (const e of seg.elements) {
    tb.append(el('tr', {}, el('td', { class: 'mono' }, e.pos), el('td', { class: 'mono' }, e.id), el('td', {}, e.name), el('td', {}, e.status), el('td', {}, String(e.repeat)), el('td', { class: 'mono' }, e.format?.raw ?? '')));
    for (const c of e.components ?? []) {
      tb.append(el('tr', {}, el('td', {}), el('td', { class: 'mono comp' }, c.id), el('td', { class: 'comp' }, c.name), el('td', {}, c.status), el('td', {}), el('td', { class: 'mono' }, c.format.raw)));
    }
  }
  t.append(tb);
  $('seg-detail').classList.remove('muted');
  $('seg-detail').replaceChildren(el('p', { class: 'spec-def muted' }, seg.function ?? ''), t);
}

fillMessages();

// Start with the D.21B BAPLIE sample.
const initial = (samples as Array<{ name: string }>).find((s) => s.name === 'BAPLIE_D21B.edi');
if (initial) {
  sampleSel.value = initial.name;
  sampleSel.dispatchEvent(new Event('change'));
}
