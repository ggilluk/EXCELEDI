import type { Issue } from './edifact/issues';
import { getValue, type Interchange, type Segment } from './edifact/model';
import { buildMessageTree, type MessageTree } from './edifact/structure';
import { parseInterchange } from './edifact/syntax';
import { validateSegment } from './edifact/validate';
import { directoryFromVersion, getDefaultRegistry, type SpecRegistry } from './spec/registry';
import { SERVICE_SEGMENTS } from './spec/service-segments';
import type { MessageDef } from './spec/types';

export interface AnalysedMessage {
  /** 1-based position in the interchange. */
  index: number;
  type: string;
  directory: string;
  def: MessageDef;
  tree: MessageTree;
}

export interface AnalysedInterchange {
  interchange: Interchange;
  messages: AnalysedMessage[];
  issues: Issue[];
}

export interface AnalyseOptions {
  registry?: SpecRegistry;
  /**
   * Directory to use instead of the one declared in UNH S009 (0052 + 0054), e.g. `D21B`.
   * Useful for messages that declare a directory that is not bundled.
   */
  directory?: string;
}

export class UnsupportedMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedMessageError';
  }
}

/** Resolves the message definition declared by a UNH segment. */
export function resolveMessageDef(unh: Segment, registry: SpecRegistry, directoryOverride?: string): MessageDef {
  const type = getValue(unh, 2, 1) ?? '';
  const version = getValue(unh, 2, 2) ?? '';
  const release = getValue(unh, 2, 3) ?? '';
  const agency = getValue(unh, 2, 4) ?? '';
  if (!directoryOverride && agency && agency !== 'UN') {
    throw new UnsupportedMessageError(`${type}: controlling agency "${agency}" is not UN`);
  }
  const directory = directoryOverride ?? directoryFromVersion(version, release);
  if (!registry.directories().includes(directory)) {
    throw new UnsupportedMessageError(
      `${type} ${version}:${release}: directory ${directory} is not bundled (available: ${registry.directories().join(', ')}). ` +
        'Use the "directory" option to read it with another directory.',
    );
  }
  if (!registry.hasMessage(directory, type)) {
    throw new UnsupportedMessageError(
      `${type} is not a container message of directory ${directory} (available: ${registry.messageTypes(directory).join(', ')})`,
    );
  }
  return registry.message(directory, type);
}

/** Parses an interchange, assigns each message to its UN structure and validates it. */
export function analyseInterchange(input: string | Uint8Array | Interchange, options: AnalyseOptions = {}): AnalysedInterchange {
  const registry = options.registry ?? getDefaultRegistry();
  const interchange = typeof input === 'string' || input instanceof Uint8Array ? parseInterchange(input) : input;
  const issues: Issue[] = [];
  const messages: AnalysedMessage[] = [];

  const svc = (seg: Segment | undefined, base: Partial<Issue> = {}) => {
    if (!seg) return;
    const def = SERVICE_SEGMENTS[seg.tag];
    if (def) issues.push(...validateSegment(def, seg, base));
  };

  svc(interchange.unb);
  interchange.groups.forEach((g) => {
    svc(g.ung);
    svc(g.une);
  });

  interchange.messages.forEach((msg, i) => {
    const index = i + 1;
    const unh = msg.segments[0];
    const def = resolveMessageDef(unh, registry, options.directory);
    const tree = buildMessageTree(def, msg.segments, index);
    issues.push(...tree.issues);
    msg.segments.forEach((seg, s) => {
      const segDef = registry.segment(def.directory, seg.tag);
      if (segDef) issues.push(...validateSegment(segDef, seg, { messageIndex: index, segmentNumber: s + 1 }));
    });

    const unt = msg.segments[msg.segments.length - 1];
    const declared = getValue(unt, 1);
    if (declared !== undefined && Number(declared) !== msg.segments.length) {
      issues.push({
        severity: 'error',
        code: 'SEGMENT_COUNT_MISMATCH',
        message: `UNT 0074 is ${declared} but the message has ${msg.segments.length} segments`,
        messageIndex: index,
        segmentNumber: msg.segments.length,
        tag: 'UNT',
      });
    }
    if (getValue(unt, 2) !== getValue(unh, 1)) {
      issues.push({
        severity: 'error',
        code: 'MESSAGE_REFERENCE_MISMATCH',
        message: `UNT 0062 "${getValue(unt, 2) ?? ''}" differs from UNH 0062 "${getValue(unh, 1) ?? ''}"`,
        messageIndex: index,
        tag: 'UNT',
      });
    }
    messages.push({ index, type: def.type, directory: def.directory, def, tree });
  });

  interchange.groups.forEach((g, gi) => {
    const count = interchange.messages.filter((m) => m.group === gi).length;
    if (!g.une) {
      issues.push({ severity: 'error', code: 'MISSING_UNE', message: `Functional group ${gi + 1} has no UNE` });
    } else if (Number(getValue(g.une, 1)) !== count) {
      issues.push({
        severity: 'error',
        code: 'GROUP_COUNT_MISMATCH',
        message: `UNE 0060 is ${getValue(g.une, 1)} but the group has ${count} messages`,
        tag: 'UNE',
      });
    }
  });

  if (!interchange.unz) {
    issues.push({ severity: 'error', code: 'MISSING_UNZ', message: 'Interchange has no UNZ' });
  } else {
    svc(interchange.unz);
    const expected = interchange.groups.length || interchange.messages.length;
    if (Number(getValue(interchange.unz, 1)) !== expected) {
      issues.push({
        severity: 'error',
        code: 'INTERCHANGE_COUNT_MISMATCH',
        message: `UNZ 0036 is ${getValue(interchange.unz, 1)} but the interchange has ${expected} ${interchange.groups.length ? 'groups' : 'messages'}`,
        tag: 'UNZ',
      });
    }
    if (getValue(interchange.unz, 2) !== getValue(interchange.unb, 5)) {
      issues.push({
        severity: 'error',
        code: 'INTERCHANGE_REFERENCE_MISMATCH',
        message: `UNZ 0020 "${getValue(interchange.unz, 2) ?? ''}" differs from UNB 0020 "${getValue(interchange.unb, 5) ?? ''}"`,
        tag: 'UNZ',
      });
    }
  }

  return { interchange, messages, issues };
}
