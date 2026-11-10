import ExcelJS from 'exceljs';
import { getValue, type Delimiters, type Interchange, type Message, type Segment, DEFAULT_DELIMITERS } from '../edifact/model';
import { trimSegment } from '../edifact/syntax';
import { resolveMessageDef } from '../document';
import { getDefaultRegistry, type SpecRegistry } from '../spec/registry';
import type { GroupNode, MessageDef, SegmentNode, StructureNode } from '../spec/types';
import { parseColumnKey, type ColumnRef } from './columns';
import {
  GROUP_HEADER,
  GROUP_NODES,
  GROUPS_SHEET,
  INFO_SHEET,
  INTERCHANGE_NODES,
  INTERCHANGE_SHEET,
  MESSAGE_PATH_RE,
  MESSAGE_SHEET_RE,
  PATH_HEADER,
  SEGMENT_SUFFIXES,
} from './layout';

export interface ReadWorkbookOptions {
  registry?: SpecRegistry;
  /** Directory to use instead of the one declared in UNH (see `AnalyseOptions.directory`). */
  directory?: string;
  /**
   * Recalculate UNT 0074 (segment count), UNE 0060 and UNZ 0036 and fill in empty control
   * references from their header segments. Default `true`.
   */
  recalculateControls?: boolean;
}

export class WorkbookFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookFormatError';
  }
}

interface SheetRow {
  sheet: string;
  rowNumber: number;
  path: string;
  group?: string;
  /** Column ref -> value (non-empty values only). */
  values: Array<{ ref: ColumnRef; value: string; header: string }>;
}

/** Converts an ExcelJS cell value to the text stored in EDIFACT. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((t) => t.text).join('');
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('text' in value) return String(value.text);
    if ('error' in value) return '';
  }
  return String(value);
}

function readTableSheet(ws: ExcelJS.Worksheet): SheetRow[] {
  // The header row is the one whose first cell is "Path".
  let headerRow = 0;
  for (let r = 1; r <= Math.min(5, ws.rowCount); r++) {
    if (cellText(ws.getRow(r).getCell(1).value).trim() === PATH_HEADER) {
      headerRow = r;
      break;
    }
  }
  if (!headerRow) throw new WorkbookFormatError(`Sheet "${ws.name}": no header row with "${PATH_HEADER}" in column A`);

  const header = ws.getRow(headerRow);
  const columns: Array<{ col: number; ref: ColumnRef; header: string }> = [];
  let groupCol = 0;
  for (let c = 2; c <= header.cellCount; c++) {
    const text = cellText(header.getCell(c).value).trim();
    if (!text) continue;
    if (text === GROUP_HEADER) {
      groupCol = c;
      continue;
    }
    const ref = parseColumnKey(text);
    if (!ref) throw new WorkbookFormatError(`Sheet "${ws.name}": cannot interpret column header "${text}"`);
    columns.push({ col: c, ref, header: text });
  }

  const rows: SheetRow[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const path = cellText(row.getCell(1).value).trim();
    const values = columns
      .map(({ col, ref, header: h }) => ({ ref, header: h, value: cellText(row.getCell(col).value) }))
      .filter((v) => v.value !== '');
    if (!path) {
      if (values.length) throw new WorkbookFormatError(`Sheet "${ws.name}" row ${r}: values without a ${PATH_HEADER}`);
      continue;
    }
    const sr: SheetRow = { sheet: ws.name, rowNumber: r, path, values };
    if (groupCol) {
      const g = cellText(row.getCell(groupCol).value).trim();
      if (g) sr.group = g;
    }
    rows.push(sr);
  }
  return rows;
}

/** Builds the segments of one row for a set of segment positions, in segment table order. */
function rowSegments(row: SheetRow | undefined, nodes: SegmentNode[], where: string): Map<SegmentNode, Segment[]> {
  const out = new Map<SegmentNode, Segment[]>();
  if (!row) return out;
  for (const { ref, value, header } of row.values) {
    const candidates = nodes.filter((n) => n.tag === ref.tag && (!ref.at || n.pos === ref.at));
    if (candidates.length === 0) {
      throw new WorkbookFormatError(`${where}: column "${header}" - segment ${ref.tag} is not part of this segment group`);
    }
    if (candidates.length > 1) {
      throw new WorkbookFormatError(`${where}: column "${header}" - ${ref.tag} occurs at several positions, use ${ref.tag}@<position>`);
    }
    const node = candidates[0];
    const list = out.get(node) ?? [];
    out.set(node, list);
    while (list.length < ref.occurrence) list.push({ tag: node.tag, elements: [] });
    const seg = list[ref.occurrence - 1];
    while (seg.elements.length <= ref.elementIndex) seg.elements.push([['']]);
    const el = seg.elements[ref.elementIndex];
    while (el.length < ref.repetition) el.push(['']);
    const rep = el[ref.repetition - 1];
    while (rep.length <= ref.componentIndex) rep.push('');
    rep[ref.componentIndex] = value;
  }
  // Drop occurrences without any value (e.g. a gap left by an emptied MEA[2]) and normalise.
  for (const [node, list] of out) {
    const kept = list.map((s) => ({ tag: s.tag, elements: trimSegment(s.elements) })).filter((s) => s.elements.length > 0);
    if (kept.length) out.set(node, kept);
    else out.delete(node);
  }
  return out;
}

interface PathParts {
  message: number;
  /** [groupId, occurrence] pairs. */
  groups: Array<[string, number]>;
}

function parsePath(path: string, where: string): PathParts {
  const m = MESSAGE_PATH_RE.exec(path);
  if (!m) throw new WorkbookFormatError(`${where}: invalid ${PATH_HEADER} "${path}" (expected e.g. M1 or M1/SG6#2/SG7#1)`);
  const groups = m[2]
    .split('/')
    .filter(Boolean)
    .map((p) => {
      const [id, occ] = p.split('#');
      return [id, Number(occ)] as [string, number];
    });
  return { message: Number(m[1]), groups };
}

const parentKey = (p: PathParts): string =>
  [`M${p.message}`, ...p.groups.slice(0, -1).map(([g, o]) => `${g}#${o}`)].join('/');
const ownKey = (p: PathParts): string => [`M${p.message}`, ...p.groups.map(([g, o]) => `${g}#${o}`)].join('/');

/** Reads a workbook written by `interchangeToWorkbook` (and possibly edited) back into an interchange. */
export function workbookToInterchange(wb: ExcelJS.Workbook, options: ReadWorkbookOptions = {}): Interchange {
  const registry = options.registry ?? getDefaultRegistry();
  const recalc = options.recalculateControls ?? true;

  // --- Info sheet: delimiters and layout ---------------------------------------------------
  let delimiters: Delimiters = { ...DEFAULT_DELIMITERS };
  let una = true;
  let segmentSuffix = '\n';
  const info = wb.getWorksheet(INFO_SHEET);
  if (info) {
    info.eachRow((row) => {
      const k = cellText(row.getCell(1).value).trim();
      const v = cellText(row.getCell(2).value);
      if (k === 'UNA') {
        if (v.length !== 6) throw new WorkbookFormatError(`Info sheet: UNA must be 6 characters, got "${v}"`);
        delimiters = { component: v[0], element: v[1], decimal: v[2], release: v[3], repetition: v[4], segment: v[5] };
      } else if (k === 'UNA present') {
        una = /^(yes|true|1)$/i.test(v.trim());
      } else if (k === 'Segment suffix') {
        const s = SEGMENT_SUFFIXES[v.trim()];
        if (s === undefined) throw new WorkbookFormatError(`Info sheet: unknown segment suffix "${v}"`);
        segmentSuffix = s;
      }
    });
  }

  // --- Interchange and functional groups ----------------------------------------------------
  const icSheet = wb.getWorksheet(INTERCHANGE_SHEET);
  if (!icSheet) throw new WorkbookFormatError(`Sheet "${INTERCHANGE_SHEET}" is missing`);
  const icRows = readTableSheet(icSheet);
  if (icRows.length !== 1) throw new WorkbookFormatError(`Sheet "${INTERCHANGE_SHEET}" must have exactly one data row`);
  const icSegs = rowSegments(icRows[0], INTERCHANGE_NODES, INTERCHANGE_SHEET);
  const unb = icSegs.get(INTERCHANGE_NODES[0])?.[0];
  if (!unb) throw new WorkbookFormatError(`Sheet "${INTERCHANGE_SHEET}": UNB has no values`);
  let unz = icSegs.get(INTERCHANGE_NODES[1])?.[0];

  const groupIndex = new Map<string, number>();
  const groups: Interchange['groups'] = [];
  const gSheet = wb.getWorksheet(GROUPS_SHEET);
  if (gSheet) {
    for (const row of readTableSheet(gSheet)) {
      const segs = rowSegments(row, GROUP_NODES, `${GROUPS_SHEET} row ${row.rowNumber}`);
      const ung = segs.get(GROUP_NODES[0])?.[0];
      if (!ung) throw new WorkbookFormatError(`${GROUPS_SHEET} row ${row.rowNumber}: UNG has no values`);
      groupIndex.set(row.path, groups.length);
      groups.push({ ung, une: segs.get(GROUP_NODES[1])?.[0] });
    }
  }

  // --- Message sheets ------------------------------------------------------------------------
  interface RootRow {
    type: string;
    row: SheetRow;
  }
  const roots = new Map<number, RootRow>();
  /** parent path key -> group rows below it */
  const children = new Map<string, Array<{ id: string; occurrence: number; row: SheetRow; type: string }>>();
  const seen = new Set<string>();

  wb.eachSheet((ws) => {
    const m = MESSAGE_SHEET_RE.exec(ws.name);
    if (!m) return;
    const [, type, , groupId] = m;
    for (const row of readTableSheet(ws)) {
      const where = `Sheet "${ws.name}" row ${row.rowNumber}`;
      const p = parsePath(row.path, where);
      const key = ownKey(p);
      if (seen.has(key)) throw new WorkbookFormatError(`${where}: duplicate ${PATH_HEADER} ${row.path}`);
      seen.add(key);
      if (!groupId) {
        if (p.groups.length) throw new WorkbookFormatError(`${where}: message sheet rows need a path like M1`);
        roots.set(p.message, { type, row });
        continue;
      }
      const last = p.groups[p.groups.length - 1];
      if (!last || last[0] !== groupId) {
        throw new WorkbookFormatError(`${where}: ${PATH_HEADER} ${row.path} does not end with ${groupId}#<n>`);
      }
      const pk = parentKey(p);
      const list = children.get(pk) ?? [];
      list.push({ id: groupId, occurrence: last[1], row, type });
      children.set(pk, list);
    }
  });

  const messages: Message[] = [];
  for (const [num, root] of [...roots.entries()].sort((a, b) => a[0] - b[0])) {
    const where = `Sheet "${root.row.sheet}" row ${root.row.rowNumber}`;
    const rootNodes = (def: MessageDef) => def.children.filter((c): c is SegmentNode => c.kind === 'segment');
    // UNH is needed first to know which UN directory defines the message.
    const unhOnly = rowSegments(
      { ...root.row, values: root.row.values.filter((v) => v.ref.tag === 'UNH') },
      [{ kind: 'segment', pos: '', tag: 'UNH', name: 'Message header', status: 'M', maxRepeat: 1 }],
      where,
    );
    const unh = [...unhOnly.values()][0]?.[0];
    if (!unh) throw new WorkbookFormatError(`${where}: UNH has no values`);
    if (getValue(unh, 2, 1) !== root.type) {
      throw new WorkbookFormatError(`${where}: UNH declares ${getValue(unh, 2, 1) ?? '?'} but the sheet is ${root.type}`);
    }
    const def = resolveMessageDef(unh, registry, options.directory);

    const emit = (nodes: StructureNode[], segs: Map<SegmentNode, Segment[]>, key: string, out: Segment[]) => {
      const kids = children.get(key) ?? [];
      for (const node of nodes) {
        if (node.kind === 'segment') {
          out.push(...(segs.get(node) ?? []));
          continue;
        }
        const instances = kids.filter((k) => k.id === node.id).sort((a, b) => a.occurrence - b.occurrence);
        instances.forEach((inst) => {
          if (inst.type !== root.type) {
            throw new WorkbookFormatError(`Sheet "${inst.row.sheet}" row ${inst.row.rowNumber}: belongs to M${num}, which is ${root.type}`);
          }
          const group = node as GroupNode;
          const segNodes = group.children.filter((c): c is SegmentNode => c.kind === 'segment');
          const groupSegs = rowSegments(inst.row, segNodes, `Sheet "${inst.row.sheet}" row ${inst.row.rowNumber}`);
          const childKey = `${key}/${node.id}#${inst.occurrence}`;
          emit(group.children, groupSegs, childKey, out);
          consumed.add(childKey);
        });
      }
    };

    const consumed = new Set<string>();
    const segments: Segment[] = [];
    emit(def.children, rowSegments(root.row, rootNodes(def), where), `M${num}`, segments);

    // Every group row must have been placed somewhere in the structure.
    for (const [pk, list] of children) {
      if (pk !== `M${num}` && !pk.startsWith(`M${num}/`)) continue;
      for (const k of list) {
        const key = `${pk}/${k.id}#${k.occurrence}`;
        if (!consumed.has(key)) {
          throw new WorkbookFormatError(
            `Sheet "${k.row.sheet}" row ${k.row.rowNumber}: ${PATH_HEADER} ${k.row.path} does not fit the ${def.type} structure (parent missing or ${k.id} not allowed there)`,
          );
        }
      }
    }

    if (recalc) {
      const unt = segments.find((s) => s.tag === 'UNT');
      if (unt) {
        while (unt.elements.length < 2) unt.elements.push([['']]);
        unt.elements[0] = [[String(segments.length)]];
        if (!getValue(unt, 2)) unt.elements[1] = [[getValue(unh, 1) ?? '']];
      }
    }

    const msg: Message = { segments };
    if (root.row.group) {
      const gi = groupIndex.get(root.row.group);
      if (gi === undefined) throw new WorkbookFormatError(`${where}: unknown functional group ${root.row.group}`);
      msg.group = gi;
    }
    messages.push(msg);
  }

  for (const [pk] of children) {
    const m = /^M(\d+(?:\.\d+)?)/.exec(pk);
    if (m && !roots.has(Number(m[1]))) {
      throw new WorkbookFormatError(`Group rows reference message ${m[0]}, which has no row in its message sheet`);
    }
  }

  if (recalc) {
    groups.forEach((g, gi) => {
      if (!g.une) g.une = { tag: 'UNE', elements: [[['']], [['']]] };
      const count = messages.filter((m) => m.group === gi).length;
      while (g.une.elements.length < 2) g.une.elements.push([['']]);
      g.une.elements[0] = [[String(count)]];
      if (!getValue(g.une, 2)) g.une.elements[1] = [[getValue(g.ung, 5) ?? '']];
    });
    unz ??= { tag: 'UNZ', elements: [[['']], [['']]] };
    while (unz.elements.length < 2) unz.elements.push([['']]);
    unz.elements[0] = [[String(groups.length || messages.length)]];
    if (!getValue(unz, 2)) unz.elements[1] = [[getValue(unb, 5) ?? '']];
  }

  return { delimiters, una, segmentSuffix, unb, unz, groups, messages };
}
