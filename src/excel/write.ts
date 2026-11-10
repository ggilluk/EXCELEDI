import ExcelJS from 'exceljs';
import type { AnalysedInterchange } from '../document';
import { formatIssue, type Issue } from '../edifact/issues';
import type { Segment } from '../edifact/model';
import type { GroupInstance } from '../edifact/structure';
import { getDefaultRegistry, type SpecRegistry } from '../spec/registry';
import { SERVICE_SEGMENTS } from '../spec/service-segments';
import type { SegmentDef, SegmentNode } from '../spec/types';
import { columnHeader, type ColumnSpec } from './columns';
import {
  GROUP_HEADER,
  GROUP_NODES,
  GROUPS_SHEET,
  INFO_SHEET,
  INTERCHANGE_NODES,
  INTERCHANGE_SHEET,
  ISSUES_SHEET,
  LAYOUT_VERSION,
  messageSheetName,
  PATH_HEADER,
  suffixName,
} from './layout';

export interface WorkbookOptions {
  registry?: SpecRegistry;
  /**
   * Add columns for every segment of every segment group that occurs, even when the segment
   * does not occur in the data. Makes it easier to add data in Excel. Default `false`.
   */
  allSegments?: boolean;
  /** Add an "Issues" sheet with the validation results. Default `true`. */
  includeIssues?: boolean;
}

interface TableRow {
  path: string;
  group?: string;
  segments: Map<SegmentNode, Segment[]>;
}

interface Table {
  name: string;
  /** Segment positions represented by this table, in segment table order. */
  nodes: SegmentNode[];
  rows: TableRow[];
  directory: string;
  title: string;
  hasGroupColumn: boolean;
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
const CAPTION_FILLS: ExcelJS.Fill[] = [
  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB4C6E7' } },
  { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6E0B4' } },
];

function directSegments(instance: GroupInstance): Map<SegmentNode, Segment[]> {
  const map = new Map<SegmentNode, Segment[]>();
  for (const e of instance.entries) {
    if (e.kind !== 'segment') continue;
    const list = map.get(e.node) ?? [];
    list.push(e.segment);
    map.set(e.node, list);
  }
  return map;
}

function segmentMap(segments: Array<Segment | undefined>, nodes: SegmentNode[]): Map<SegmentNode, Segment[]> {
  const map = new Map<SegmentNode, Segment[]>();
  segments.forEach((s, i) => {
    if (s) map.set(nodes[i], [s]);
  });
  return map;
}

function collectTables(doc: AnalysedInterchange): Table[] {
  const { interchange } = doc;
  const tables: Table[] = [];
  const hasGroups = interchange.groups.length > 0;

  tables.push({
    name: INTERCHANGE_SHEET,
    nodes: INTERCHANGE_NODES,
    directory: '',
    title: 'Interchange header and trailer',
    hasGroupColumn: false,
    rows: [
      {
        path: 'I1',
        segments: segmentMap([interchange.unb, interchange.unz], INTERCHANGE_NODES),
      },
    ],
  });

  if (hasGroups) {
    tables.push({
      name: GROUPS_SHEET,
      nodes: GROUP_NODES,
      directory: '',
      title: 'Functional groups',
      hasGroupColumn: false,
      rows: interchange.groups.map((g, i) => ({
        path: `G${i + 1}`,
        segments: segmentMap([g.ung, g.une], GROUP_NODES),
      })),
    });
  }

  // Sheet names include the directory only when one message type occurs in several directories.
  const dirsByType = new Map<string, Set<string>>();
  for (const m of doc.messages) {
    const s = dirsByType.get(m.type) ?? new Set<string>();
    s.add(m.directory);
    dirsByType.set(m.type, s);
  }

  const byName = new Map<string, Table>();
  const table = (name: string, init: () => Omit<Table, 'rows' | 'name'>): Table => {
    let t = byName.get(name);
    if (!t) {
      t = { name, rows: [], ...init() };
      byName.set(name, t);
    }
    return t;
  };

  for (const m of doc.messages) {
    const dir = (dirsByType.get(m.type)?.size ?? 0) > 1 ? m.directory : undefined;
    const msg = interchange.messages[m.index - 1];
    const rootTable = table(messageSheetName(m.type, dir, undefined), () => ({
      nodes: m.def.children.filter((c): c is SegmentNode => c.kind === 'segment'),
      directory: m.directory,
      title: `${m.type} ${m.def.version}:${m.def.release} - ${m.def.name}`,
      hasGroupColumn: hasGroups,
    }));
    rootTable.rows.push({
      path: `M${m.index}`,
      group: msg.group !== undefined ? `G${msg.group + 1}` : undefined,
      segments: directSegments(m.tree.root),
    });

    const visit = (instance: GroupInstance) => {
      for (const e of instance.entries) {
        if (e.kind !== 'group') continue;
        const g = e.node;
        const t = table(messageSheetName(m.type, dir, g.id), () => ({
          nodes: g.children.filter((c): c is SegmentNode => c.kind === 'segment'),
          directory: m.directory,
          title: `${m.type} ${m.def.version}:${m.def.release} segment group ${g.id.slice(2)} (${g.pos}): ${g.children
            .map((c) => (c.kind === 'segment' ? c.tag : c.id))
            .join('-')}`,
          hasGroupColumn: false,
        }));
        t.rows.push({ path: `M${m.index}/${e.instance.path}`, segments: directSegments(e.instance) });
        visit(e.instance);
      }
    };
    visit(m.tree.root);
  }

  // Message sheets in order of appearance, each followed by its group sheets (SG1, SG2, ...).
  tables.push(...stableGroupByType([...byName.values()]));
  return tables;
}

function splitName(name: string): [string, number] {
  const m = /^(.*?)(?: SG(\d+))?$/.exec(name)!;
  return [m[1], m[2] ? Number(m[2]) : 0];
}

function stableGroupByType(tables: Table[]): Table[] {
  const types: string[] = [];
  const by = new Map<string, Table[]>();
  for (const t of tables) {
    const [type] = splitName(t.name);
    if (!by.has(type)) {
      types.push(type);
      by.set(type, []);
    }
    by.get(type)!.push(t);
  }
  return types.flatMap((t) => by.get(t)!.sort((a, b) => splitName(a.name)[1] - splitName(b.name)[1]));
}

function buildColumns(t: Table, registry: SpecRegistry, allSegments: boolean): ColumnSpec[] {
  const cols: ColumnSpec[] = [];
  for (const node of t.nodes) {
    const used = t.rows.map((r) => r.segments.get(node) ?? []);
    const occurrences = Math.max(allSegments ? 1 : 0, ...used.map((u) => u.length));
    if (occurrences === 0) continue;
    const def: SegmentDef | undefined = SERVICE_SEGMENTS[node.tag] ?? registry.segment(t.directory, node.tag);
    const disambiguate = t.nodes.filter((n) => n.tag === node.tag).length > 1;
    const all = used.flat();
    const elementCount = Math.max(def?.elements.length ?? 0, ...all.map((s) => s.elements.length));

    for (let occ = 1; occ <= occurrences; occ++) {
      for (let e = 0; e < elementCount; e++) {
        const ed = def?.elements[e];
        const values = all.map((s) => s.elements[e]).filter(Boolean);
        const reps = Math.max(1, ...values.map((v) => v.length));
        const maxComps = Math.max(1, ...values.flatMap((v) => v.map((r) => r.length)));
        const composite = ed ? Boolean(ed.components) || maxComps > 1 : maxComps > 1;
        const comps = composite ? Math.max(ed?.components?.length ?? 0, maxComps) : 1;
        const repeatable = (ed?.repeat ?? 1) > 1 || reps > 1;
        for (let r = 1; r <= reps; r++) {
          for (let c = 0; c < comps; c++) {
            const { header, note } = columnHeader(node, disambiguate, occ, e, r, composite ? c : undefined, def, repeatable);
            cols.push({
              tag: node.tag,
              ...(disambiguate ? { at: node.pos } : {}),
              occurrence: occ,
              elementIndex: e,
              repetition: r,
              componentIndex: c,
              composite,
              header,
              note,
              node,
            });
          }
        }
      }
    }
  }
  return cols;
}

function writeTable(wb: ExcelJS.Workbook, t: Table, registry: SpecRegistry, allSegments: boolean): void {
  const ws = wb.addWorksheet(t.name, { properties: { defaultColWidth: 16 } });
  const cols = buildColumns(t, registry, allSegments);
  const fixed = [PATH_HEADER, ...(t.hasGroupColumn ? [GROUP_HEADER] : [])];

  // Row 1: segment captions spanning their columns; row 2: column keys.
  const caption = ws.getRow(1);
  const header = ws.getRow(2);
  caption.getCell(1).value = t.title;
  fixed.forEach((h, i) => {
    const cell = header.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
  });

  let blockStart = 0;
  let block = 0;
  cols.forEach((c, i) => {
    const col = fixed.length + i + 1;
    const cell = header.getCell(col);
    cell.value = c.header;
    cell.note = c.note;
    cell.font = { bold: true };
    cell.fill = HEADER_FILL;
    cell.alignment = { wrapText: true, vertical: 'top' };
    ws.getColumn(col).numFmt = '@';
    ws.getColumn(col).width = 18;

    const next = cols[i + 1];
    if (!next || next.node !== c.node || next.occurrence !== c.occurrence) {
      const from = fixed.length + blockStart + 1;
      const capCell = caption.getCell(from);
      capCell.value = `${c.tag}${c.node.maxRepeat > 1 ? `[${c.occurrence}]` : ''} ${c.node.name}${c.node.pos ? ` (${c.node.pos})` : ''}`;
      capCell.font = { bold: true };
      capCell.fill = CAPTION_FILLS[block % 2];
      if (col > from) ws.mergeCells(1, from, 1, col);
      blockStart = i + 1;
      block++;
    }
  });
  header.height = 45;
  ws.getColumn(1).width = t.name === INTERCHANGE_SHEET || t.name === GROUPS_SHEET ? 8 : 24;
  ws.getColumn(1).numFmt = '@';

  t.rows.forEach((row, r) => {
    const xr = ws.getRow(r + 3);
    xr.getCell(1).value = row.path;
    if (t.hasGroupColumn) xr.getCell(2).value = row.group ?? '';
    cols.forEach((c, i) => {
      const seg = row.segments.get(c.node)?.[c.occurrence - 1];
      const v = seg?.elements[c.elementIndex]?.[c.repetition - 1]?.[c.componentIndex];
      if (v !== undefined && v !== '') xr.getCell(fixed.length + i + 1).value = v;
    });
  });

  ws.views = [{ state: 'frozen', xSplit: fixed.length, ySplit: 2 }];
  if (cols.length + fixed.length > 0) {
    ws.autoFilter = { from: { row: 2, column: 1 }, to: { row: 2 + t.rows.length, column: cols.length + fixed.length } };
  }
}

function writeInfo(wb: ExcelJS.Workbook, doc: AnalysedInterchange): void {
  const ws = wb.addWorksheet(INFO_SHEET);
  const d = doc.interchange.delimiters;
  ws.columns = [
    { header: 'Key', key: 'k', width: 28 },
    { header: 'Value', key: 'v', width: 80 },
  ];
  ws.getRow(1).font = { bold: true };
  const rows: [string, string][] = [
    ['Generator', 'edifact-excel-transformer'],
    ['Layout version', LAYOUT_VERSION],
    ['UNA', `${d.component}${d.element}${d.decimal}${d.release}${d.repetition}${d.segment}`],
    ['UNA present', doc.interchange.una ? 'yes' : 'no'],
    ['Segment suffix', suffixName(doc.interchange.segmentSuffix)],
    ['Messages', String(doc.messages.length)],
    ['Errors', String(doc.issues.filter((i) => i.severity === 'error').length)],
    ['Warnings', String(doc.issues.filter((i) => i.severity === 'warning').length)],
  ];
  for (const [k, v] of rows) ws.addRow({ k, v }).getCell(2).numFmt = '@';
  ws.addRow({});
  ws.addRow({
    k: 'How to edit',
    v:
      'Each sheet holds one level of the UN segment table: the message level (e.g. "BAPLIE") and one sheet per segment group (e.g. "BAPLIE SG6"). ' +
      'One row is one occurrence; the Path column links it to its message and parent group (M1/SG6#3/SG7#1 = message 1, 3rd SG6, its 1st SG7). ' +
      'Column headers name the segment, element position and component (EQD 020.1 = EQD, 2nd data element, 1st component). ' +
      'To add an occurrence, add a row with a new Path. UNT/UNE/UNZ counts are recalculated when converting back to EDIFACT.',
  }).getCell(2).alignment = { wrapText: true };
  ws.addRow({});
  const head = ws.addRow({ k: 'Message', v: 'Type / directory / reference / name' });
  head.font = { bold: true };
  for (const m of doc.messages) {
    const unh = doc.interchange.messages[m.index - 1].segments[0];
    ws.addRow({ k: `M${m.index}`, v: `${m.type} ${m.def.version}:${m.def.release} (${m.directory}) ref ${unh.elements[0]?.[0]?.[0] ?? ''} - ${m.def.name}` });
  }
}

function writeIssues(wb: ExcelJS.Workbook, issues: Issue[]): void {
  const ws = wb.addWorksheet(ISSUES_SHEET);
  ws.columns = [
    { header: 'Severity', key: 'severity', width: 10 },
    { header: 'Code', key: 'code', width: 30 },
    { header: 'Message #', key: 'messageIndex', width: 10 },
    { header: 'Segment #', key: 'segmentNumber', width: 10 },
    { header: 'Tag', key: 'tag', width: 8 },
    { header: 'Path', key: 'path', width: 20 },
    { header: 'Element', key: 'element', width: 10 },
    { header: 'Description', key: 'message', width: 100 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const i of issues) ws.addRow({ ...i });
}

/** Builds an Excel workbook from an analysed interchange. */
export function interchangeToWorkbook(doc: AnalysedInterchange, options: WorkbookOptions = {}): ExcelJS.Workbook {
  const registry = options.registry ?? getDefaultRegistry();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'edifact-excel-transformer';
  wb.created = new Date(0);
  wb.modified = new Date(0);
  writeInfo(wb, doc);
  for (const t of collectTables(doc)) writeTable(wb, t, registry, options.allSegments ?? false);
  if ((options.includeIssues ?? true) && doc.issues.length > 0) writeIssues(wb, doc.issues);
  return wb;
}

export { formatIssue };
