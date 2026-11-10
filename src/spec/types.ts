/**
 * Type model for UN/EDIFACT specifications.
 *
 * Instances of these types are produced by `scripts/build-specs.ts`, which parses the
 * official UNTDID directory files (EDMD/TRMD message directories, EDSD/TRSD segment
 * directories) shipped in `untdid/*.zip`, and by `src/spec/service-segments.ts` for the
 * ISO 9735 service segments (UNB, UNH, ...), which are not part of the batch directories.
 */

export type Status = 'M' | 'C';

/** Data element representation, e.g. `an..35`, `n3`, `a1`. */
export interface Format {
  /** `a` alphabetic, `n` numeric, `an` alphanumeric. */
  type: 'a' | 'n' | 'an';
  /** Minimum length (equals max for fixed-length representations). */
  min: number;
  max: number;
  /** Representation exactly as written in the directory, e.g. `an..17`. */
  raw: string;
}

export interface ComponentDef {
  /** Data element tag, e.g. `8260`. */
  id: string;
  name: string;
  status: Status;
  format: Format;
}

export interface ElementDef {
  /** Position of the element in the segment as written in the directory, e.g. `020`. */
  pos: string;
  /** Simple data element tag (`8053`) or composite tag (`C237`, `S009`). */
  id: string;
  name: string;
  status: Status;
  /** Maximum number of repetitions (syntax version 4). Always 1 in older directories. */
  repeat: number;
  /** Present for simple data elements. */
  format?: Format;
  /** Present for composite data elements. */
  components?: ComponentDef[];
}

export interface SegmentDef {
  tag: string;
  name: string;
  function?: string;
  elements: ElementDef[];
}

export interface SegmentNode {
  kind: 'segment';
  /** Position in the message segment table, e.g. `00260` (or `0240` in old directories). */
  pos: string;
  tag: string;
  name: string;
  status: Status;
  maxRepeat: number;
}

export interface GroupNode {
  kind: 'group';
  pos: string;
  /** e.g. `SG7`. */
  id: string;
  status: Status;
  maxRepeat: number;
  children: StructureNode[];
}

export type StructureNode = SegmentNode | GroupNode;

export interface MessageDef {
  /** Message type, e.g. `BAPLIE`. */
  type: string;
  /** Directory key, e.g. `D21B`. */
  directory: string;
  /** Official title of the message, e.g. `Bayplan/stowage plan occupied and empty locations message`. */
  name: string;
  version: string;
  release: string;
  agency: string;
  revision?: string;
  date?: string;
  /** Functional definition from section 1.1 of the message specification. */
  functionalDefinition?: string;
  children: StructureNode[];
}

export interface DirectorySpec {
  /** Directory key, e.g. `D21B`. */
  directory: string;
  /** Source zip the spec was generated from (relative to repository root). */
  source: string;
  messages: Record<string, MessageDef>;
  /** Segment definitions needed by `messages` (UN directory segments only). */
  segments: Record<string, SegmentDef>;
}

export interface SpecIndex {
  generatedAt: string;
  directories: Record<string, { file: string; messages: string[] }>;
}
