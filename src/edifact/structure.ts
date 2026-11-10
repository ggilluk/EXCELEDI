import type { GroupNode, MessageDef, SegmentNode, StructureNode } from '../spec/types';
import type { Issue } from './issues';
import type { Segment } from './model';

/**
 * Assigns the segments of a message to the positions of the UN segment table, producing the
 * segment-group hierarchy.
 *
 * Matching follows the ISO 9735 rules for the order of segments and segment groups: segments
 * appear in table order; a segment group is entered by its first (trigger) segment; a segment
 * is matched in the innermost open group first and then in the enclosing groups, searching
 * forward from the current position only. A repeated trigger segment starts a new occurrence of
 * the group.
 */

export interface SegmentOccurrence {
  kind: 'segment';
  node: SegmentNode;
  segment: Segment;
  /** 0-based index within the message (UNH = 0). */
  index: number;
}

export interface GroupOccurrence {
  kind: 'group';
  node: GroupNode;
  instance: GroupInstance;
}

export interface GroupInstance {
  /** `undefined` for the message level. */
  group?: GroupNode;
  /** 1-based occurrence number of this instance within its parent. */
  occurrence: number;
  /** e.g. `SG6#3/SG7#1`; empty for the message level. */
  path: string;
  entries: Array<SegmentOccurrence | GroupOccurrence>;
}

export interface MessageTree {
  def: MessageDef;
  root: GroupInstance;
  issues: Issue[];
}

interface Frame {
  children: StructureNode[];
  instance: GroupInstance;
  /** Index of the child last matched (or 0 before the first match). */
  at: number;
  counts: number[];
}

const triggerTag = (n: StructureNode): string => (n.kind === 'segment' ? n.tag : triggerTag(n.children[0]));

export class StructureError extends Error {
  constructor(
    message: string,
    readonly issues: Issue[],
  ) {
    super(message);
    this.name = 'StructureError';
  }
}

export function buildMessageTree(def: MessageDef, segments: Segment[], messageIndex?: number): MessageTree {
  const issues: Issue[] = [];
  const root: GroupInstance = { occurrence: 1, path: '', entries: [] };
  const stack: Frame[] = [{ children: def.children, instance: root, at: 0, counts: def.children.map(() => 0) }];

  const issue = (i: Omit<Issue, 'severity' | 'messageIndex'> & { severity?: Issue['severity'] }) =>
    issues.push({ severity: 'error', messageIndex, ...i } as Issue);

  /** Reports mandatory children in [from, to) that did not occur. */
  const checkMissing = (frame: Frame, from: number, to: number, beforeSegment?: number) => {
    for (let k = from; k < to; k++) {
      const child = frame.children[k];
      if (child.status === 'M' && frame.counts[k] === 0) {
        issue({
          code: child.kind === 'segment' ? 'MISSING_MANDATORY_SEGMENT' : 'MISSING_MANDATORY_GROUP',
          message:
            child.kind === 'segment'
              ? `Mandatory segment ${child.tag} (${child.pos}) is missing`
              : `Mandatory segment group ${child.id} (${child.pos}) is missing`,
          path: frame.instance.path,
          segmentNumber: beforeSegment,
          tag: child.kind === 'segment' ? child.tag : undefined,
        });
      }
    }
  };

  const closeFrame = (frame: Frame, beforeSegment?: number) => {
    checkMissing(frame, frame.counts[frame.at] > 0 ? frame.at + 1 : frame.at, frame.children.length, beforeSegment);
  };

  const find = (frame: Frame, tag: string, allowOverflow: boolean): number => {
    for (let k = frame.at; k < frame.children.length; k++) {
      const child = frame.children[k];
      if (triggerTag(child) !== tag) continue;
      if (k === frame.at && frame.counts[k] >= child.maxRepeat && !allowOverflow) continue;
      // An excess trigger segment is an excess occurrence of the group, not of the trigger.
      if (allowOverflow && k === 0 && frame.instance.group) continue;
      return k;
    }
    return -1;
  };

  const place = (frame: Frame, depth: number, k: number, seg: Segment, index: number) => {
    // Close the groups nested deeper than the matching level.
    while (stack.length - 1 > depth) closeFrame(stack.pop()!, index + 1);
    const start = frame.counts[frame.at] > 0 ? frame.at + 1 : frame.at;
    checkMissing(frame, start, k, index + 1);
    const child = frame.children[k];
    frame.at = k;
    frame.counts[k]++;
    if (frame.counts[k] > child.maxRepeat) {
      issue({
        code: child.kind === 'segment' ? 'SEGMENT_REPEATED_TOO_OFTEN' : 'GROUP_REPEATED_TOO_OFTEN',
        message: `${child.kind === 'segment' ? `Segment ${child.tag}` : `Segment group ${child.id}`} (${child.pos}) occurs more than ${child.maxRepeat} time(s)`,
        path: frame.instance.path,
        segmentNumber: index + 1,
        tag: seg.tag,
      });
    }
    if (child.kind === 'segment') {
      frame.instance.entries.push({ kind: 'segment', node: child, segment: seg, index });
      return;
    }
    // Enter a new occurrence of the group, then place the segment within it (nested groups
    // may start with the same trigger).
    const occurrence = frame.counts[k];
    const instance: GroupInstance = {
      group: child,
      occurrence,
      path: `${frame.instance.path ? `${frame.instance.path}/` : ''}${child.id}#${occurrence}`,
      entries: [],
    };
    frame.instance.entries.push({ kind: 'group', node: child, instance });
    const inner: Frame = { children: child.children, instance, at: 0, counts: child.children.map(() => 0) };
    stack.push(inner);
    place(inner, stack.length - 1, 0, seg, index);
  };

  segments.forEach((seg, index) => {
    for (const allowOverflow of [false, true]) {
      for (let depth = stack.length - 1; depth >= 0; depth--) {
        const frame = stack[depth];
        const k = find(frame, seg.tag, allowOverflow);
        if (k >= 0) {
          place(frame, depth, k, seg, index);
          return;
        }
      }
    }
    issue({
      code: 'UNEXPECTED_SEGMENT',
      message: `Segment ${seg.tag} is not expected at this position of ${def.type} ${def.version}:${def.release}`,
      segmentNumber: index + 1,
      tag: seg.tag,
      path: stack[stack.length - 1].instance.path,
    });
  });
  while (stack.length > 0) closeFrame(stack.pop()!, undefined);

  return { def, root, issues };
}

/** Flattens a message tree back into segment order. */
export function flattenTree(instance: GroupInstance): Segment[] {
  const out: Segment[] = [];
  for (const e of instance.entries) {
    if (e.kind === 'segment') out.push(e.segment);
    else out.push(...flattenTree(e.instance));
  }
  return out;
}
