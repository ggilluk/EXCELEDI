export type Severity = 'error' | 'warning';

export interface Issue {
  severity: Severity;
  /** Stable machine-readable code, e.g. `MISSING_MANDATORY_SEGMENT`. */
  code: string;
  message: string;
  /** 1-based index of the message in the interchange. */
  messageIndex?: number;
  /** 1-based position of the segment within its message (UNH = 1). */
  segmentNumber?: number;
  tag?: string;
  /** Group path, e.g. `SG6#3/SG7#1`. */
  path?: string;
  /** Element / component position, e.g. `020.1`. */
  element?: string;
}

export function formatIssue(i: Issue): string {
  const where = [
    i.messageIndex !== undefined ? `message ${i.messageIndex}` : undefined,
    i.segmentNumber !== undefined ? `segment ${i.segmentNumber}` : undefined,
    i.path || undefined,
    i.tag ? `${i.tag}${i.element ? ` ${i.element}` : ''}` : undefined,
  ]
    .filter(Boolean)
    .join(', ');
  return `${i.severity.toUpperCase()} ${i.code}${where ? ` [${where}]` : ''}: ${i.message}`;
}
