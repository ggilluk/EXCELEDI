import ExcelJS from 'exceljs';
import { analyseInterchange, type AnalysedInterchange, type AnalyseOptions } from './document';
import type { Issue } from './edifact/issues';
import { StructureError } from './edifact/structure';
import { encodeInterchange, serializeInterchange, type SerializeOptions } from './edifact/syntax';
import { getValue } from './edifact/model';
import { workbookToInterchange, type ReadWorkbookOptions } from './excel/read';
import { interchangeToWorkbook, type WorkbookOptions } from './excel/write';

export * from './spec/types';
export { CONTAINER_MESSAGES, type ContainerMessageType } from './spec/container-messages';
export { SpecRegistry, getDefaultRegistry, normaliseDirectory } from './spec/registry';
export { SERVICE_SEGMENTS } from './spec/service-segments';
export * from './edifact/model';
export { formatIssue, type Issue, type Severity } from './edifact/issues';
export { parseInterchange, serializeInterchange, serializeSegment, tokenize, EdifactSyntaxError } from './edifact/syntax';
export { buildMessageTree, flattenTree, StructureError, type MessageTree, type GroupInstance } from './edifact/structure';
export { validateSegment } from './edifact/validate';
export { analyseInterchange, resolveMessageDef, UnsupportedMessageError } from './document';
export type { AnalysedInterchange, AnalysedMessage, AnalyseOptions } from './document';
export { interchangeToWorkbook, type WorkbookOptions } from './excel/write';
export { workbookToInterchange, WorkbookFormatError, type ReadWorkbookOptions } from './excel/read';
export { parseColumnKey, type ColumnRef } from './excel/columns';

export interface EdiToExcelOptions extends AnalyseOptions, WorkbookOptions {}

export interface EdiToExcelResult {
  /** The `.xlsx` file contents. */
  xlsx: Buffer;
  workbook: ExcelJS.Workbook;
  analysis: AnalysedInterchange;
  issues: Issue[];
}

/**
 * Converts an EDIFACT interchange to an Excel workbook.
 *
 * Validation problems are reported in `issues` (and the workbook's "Issues" sheet). Segments
 * that cannot be placed in the UN message structure would be lost, so they raise a
 * `StructureError` instead.
 */
export async function ediToExcel(input: string | Uint8Array, options: EdiToExcelOptions = {}): Promise<EdiToExcelResult> {
  const analysis = analyseInterchange(input, options);
  const unplaced = analysis.issues.filter((i) => i.code === 'UNEXPECTED_SEGMENT');
  if (unplaced.length) {
    throw new StructureError(
      `${unplaced.length} segment(s) do not fit the UN message structure: ${unplaced
        .slice(0, 5)
        .map((i) => `message ${i.messageIndex} segment ${i.segmentNumber} ${i.tag}`)
        .join('; ')}`,
      unplaced,
    );
  }
  const workbook = interchangeToWorkbook(analysis, options);
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  return { xlsx, workbook, analysis, issues: analysis.issues };
}

export interface ExcelToEdiOptions extends ReadWorkbookOptions, SerializeOptions {}

export interface ExcelToEdiResult {
  /** EDIFACT text. */
  edi: string;
  /** EDIFACT encoded for the syntax identifier in UNB (ISO 8859-1, or UTF-8 for UNOW/UNOY). */
  bytes: Buffer;
  analysis: AnalysedInterchange;
  issues: Issue[];
}

/** Converts a workbook produced by `ediToExcel` (possibly edited) back to EDIFACT. */
export async function excelToEdi(
  xlsx: Buffer | ArrayBuffer | Uint8Array | ExcelJS.Workbook,
  options: ExcelToEdiOptions = {},
): Promise<ExcelToEdiResult> {
  let workbook: ExcelJS.Workbook;
  if (xlsx instanceof ExcelJS.Workbook) {
    workbook = xlsx;
  } else {
    workbook = new ExcelJS.Workbook();
    const data = xlsx instanceof ArrayBuffer ? Buffer.from(xlsx) : Buffer.from(xlsx.buffer, xlsx.byteOffset, xlsx.byteLength);
    await workbook.xlsx.load(data as unknown as ExcelJS.Buffer);
  }
  const interchange = workbookToInterchange(workbook, options);
  const edi = serializeInterchange(interchange, options);
  const analysis = analyseInterchange(interchange, options);
  return {
    edi,
    bytes: encodeInterchange(edi, getValue(interchange.unb, 1, 1)),
    analysis,
    issues: analysis.issues,
  };
}
