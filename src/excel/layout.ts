import type { SegmentNode } from '../spec/types';
import { SERVICE_SEGMENTS } from '../spec/service-segments';

/** Constants shared by the workbook writer and reader. */
export const LAYOUT_VERSION = '1';
export const INFO_SHEET = 'Info';
export const INTERCHANGE_SHEET = 'Interchange';
export const GROUPS_SHEET = 'Groups';
export const ISSUES_SHEET = 'Issues';
export const PATH_HEADER = 'Path';
export const GROUP_HEADER = 'Functional group';

/** `BAPLIE`, `BAPLIE SG6`, `BAPLIE D95B`, `BAPLIE D95B SG2`. */
export const MESSAGE_SHEET_RE = /^([A-Z]{6})(?: (D\d\d[A-Z]))?(?: (SG\d+))?$/;

export function messageSheetName(type: string, directory: string | undefined, groupId: string | undefined): string {
  return [type, directory, groupId].filter(Boolean).join(' ');
}

const serviceNode = (tag: string): SegmentNode => ({
  kind: 'segment',
  pos: '',
  tag,
  name: SERVICE_SEGMENTS[tag].name,
  status: tag === 'UNB' || tag === 'UNG' ? 'M' : 'C',
  maxRepeat: 1,
});

export const INTERCHANGE_NODES: SegmentNode[] = [serviceNode('UNB'), serviceNode('UNZ')];
export const GROUP_NODES: SegmentNode[] = [serviceNode('UNG'), serviceNode('UNE')];

/** Message path `M3`, group instance path `M3/SG6#12/SG7#1`. */
export const MESSAGE_PATH_RE = /^M(\d+(?:\.\d+)?)((?:\/SG\d+#\d+(?:\.\d+)?)*)$/;

export const SEGMENT_SUFFIXES: Record<string, string> = { none: '', LF: '\n', CRLF: '\r\n', CR: '\r' };
export function suffixName(suffix: string): string {
  return Object.entries(SEGMENT_SUFFIXES).find(([, v]) => v === suffix)?.[0] ?? 'none';
}
