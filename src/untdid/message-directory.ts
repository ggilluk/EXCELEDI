import type { GroupNode, MessageDef, Status, StructureNode } from '../spec/types';

/**
 * Parser for UNTDID message specifications (`EDMD/<TYPE>_D.yyx` or `TRMD/<TYPE>_D.yyx`).
 *
 * The message structure is taken from section 4.3.1 "Segment table", e.g.
 *
 * ```
 * Pos     Tag Name                                     S   R
 *
 * 00010   UNH Message header                           M   1
 * 00040       ---- Segment group 1  ------------------ C   9----------------+
 * 00050   RFF Reference                                M   1                |
 * 00060   DTM Date/time/period                         C   9----------------+
 * ```
 *
 * A segment group header line opens a group (`+` in the right-hand box drawing). Each `+`
 * after a segment's repetition count closes one group, so a segment ending in `---++` is the
 * last segment of two nested groups.
 */

const CI = '[+*#|X-]{0,3}';
/** Some directories (e.g. D.00B) print the change indicator between position and tag. */
const CI_AFTER_POS = '(?:[+*#|X]\\s+)?';
const GROUP_RE = new RegExp(
  `^${CI}\\s*(\\d{4,5})\\s+${CI_AFTER_POS}-+\\s*Segment group\\s+(\\d+)\\s*-+\\s+([MC])\\s+(\\d+)\\s*([-+|\\s]*)$`,
);
const SEGMENT_RE = new RegExp(`^${CI}\\s*(\\d{4,5})\\s+${CI_AFTER_POS}([A-Z]{3})\\s+(.+?)\\s+([MC])\\s+(\\d+)\\s*([-+|\\s]*)$`);

export function parseMessageSpecification(text: string, directory: string): MessageDef {
  const lines = text.split('\n');

  const header = (label: string): string | undefined => {
    const re = new RegExp(`^\\s*${label.replace(/[.]/g, '\\.')}\\s*:\\s*(\\S.*?)\\s*$`);
    for (const l of lines) {
      const m = re.exec(l);
      if (m) return m[1];
    }
    return undefined;
  };

  const type = header('Message Type');
  if (!type) throw new Error('Message specification without "Message Type"');
  const version = header('Version') ?? '';
  const release = header('Release') ?? '';
  const agency = header('Contr. Agency') ?? '';

  // The title is the first non-empty line after "UNITED NATIONS STANDARD MESSAGE (UNSM)"
  // (or "DRAFT RECOMMENDATION" for messages in draft status, e.g. in D.95B).
  let name = type;
  const unsm = lines.findIndex((l) => /UNITED NATIONS STANDARD MESSAGE|DRAFT RECOMMENDATION/.test(l));
  if (unsm >= 0) {
    const t = lines.slice(unsm + 1).find((l) => l.trim());
    if (t) name = t.trim();
  }

  const msg: MessageDef = {
    type,
    directory,
    name,
    version,
    release,
    agency,
    children: [],
  };
  const revision = header('Revision');
  if (revision) msg.revision = revision;
  const date = header('Date');
  if (date) msg.date = date;
  const fd = functionalDefinition(lines);
  if (fd) msg.functionalDefinition = fd;

  // Locate the segment table (the last "Segment table" heading followed by the "Pos Tag" header).
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/Segment table/i.test(lines[i]) && lines.slice(i + 1, i + 4).some((l) => /^\s*Pos\s+Tag\s+Name/.test(l))) {
      start = i;
    }
  }
  if (start < 0) throw new Error(`${type}: segment table not found`);

  const root: GroupNode = { kind: 'group', pos: '', id: '', status: 'M', maxRepeat: 1, children: [] };
  const stack: GroupNode[] = [root];
  let sawUnt = false;

  for (let i = start + 1; i < lines.length && !sawUnt; i++) {
    const line = lines[i].trimEnd();
    let m = GROUP_RE.exec(line);
    if (m) {
      const g: GroupNode = {
        kind: 'group',
        pos: m[1],
        id: `SG${Number(m[2])}`,
        status: m[3] as Status,
        maxRepeat: Number(m[4]),
        children: [],
      };
      stack[stack.length - 1].children.push(g);
      stack.push(g);
      continue;
    }
    m = SEGMENT_RE.exec(line);
    if (m) {
      const [, pos, tag, segName, status, repeat, tail] = m;
      stack[stack.length - 1].children.push({
        kind: 'segment',
        pos,
        tag,
        name: segName.trim(),
        status: status as Status,
        maxRepeat: Number(repeat),
      });
      const closes = (tail.match(/\+/g) ?? []).length;
      for (let c = 0; c < closes; c++) {
        if (stack.length <= 1) throw new Error(`${type}: unbalanced segment group close at ${pos}`);
        stack.pop();
      }
      if (tag === 'UNT') sawUnt = true;
    }
  }
  if (!sawUnt) throw new Error(`${type}: segment table does not end with UNT`);
  if (stack.length !== 1) throw new Error(`${type}: ${stack.length - 1} segment group(s) not closed`);

  checkGroups(type, root.children);
  msg.children = root.children;
  return msg;
}

function checkGroups(type: string, nodes: StructureNode[]): void {
  for (const n of nodes) {
    if (n.kind !== 'group') continue;
    const first = n.children[0];
    if (!first || first.kind !== 'segment') throw new Error(`${type}: ${n.id} does not start with a segment`);
    checkGroups(type, n.children);
  }
}

function functionalDefinition(lines: string[]): string | undefined {
  // Section "1.1 Functional definition" -- skip the table of contents entry (first match).
  const idx: number[] = [];
  lines.forEach((l, i) => {
    if (/^\s*1\.1\s+Functional definition/i.test(l)) idx.push(i);
  });
  const at = idx[idx.length - 1];
  if (at === undefined) return undefined;
  const out: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    if (/^\s*1\.2\s/.test(lines[i]) || /^\s*2\.\s/.test(lines[i])) break;
    out.push(lines[i].trim());
  }
  const text = out.join('\n').trim().replace(/\n{2,}/g, '\n\n').replace(/([^\n])\n(?!\n)/g, '$1 ');
  return text || undefined;
}
