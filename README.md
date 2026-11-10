# edifact-excel-transformer

TypeScript transformer between **UN/EDIFACT container messages** (BAPLIE, COPRAR, COARRI,
CODECO, COPARN, VERMAS, MOVINS, ...) and **Excel workbooks**, in both directions.

Message structures and segment layouts are **not hand-written**: they are generated from the
original UN/EDIFACT directory files (UNTDID) published by UNECE, bundled unmodified in
[`untdid/`](untdid). Every message is validated against them.

## Supported messages and directories

| Directory | Messages |
|-----------|----------|
| D.95B | BAPLIE CALINF COARRI CODECO CODENO COEDOR COHAOR COPARN COPINO COPRAR COREOR COSTCO COSTOR MOVINS VESDEP |
| D.00B | as D.95B + DESTIM TPFREP |
| D.13B | as D.00B |
| D.16A | as D.00B + VERMAS |
| D.21B | as D.16A |

The set of messages is taken from the UN specifications themselves: the messages whose scope
states *"This message is part of a total set of container-related messages"* (CALINF, COARRI,
CODECO, CODENO, COEDOR, COHAOR, COPARN, COPINO, COPRAR, COREOR, COSTCO, COSTOR, VESDEP) plus the
messages whose functional definition concerns stowage, repair, weighing or terminal handling
of containers (BAPLIE, MOVINS, DESTIM, TPFREP, VERMAS). See
[`src/spec/container-messages.ts`](src/spec/container-messages.ts).

The directory of each message is taken from its `UNH` (S009 0052/0054, e.g. `BAPLIE:D:95B:UN`).
Another directory can be forced with the `directory` option / `--directory` flag. Adding a
directory is a matter of dropping the UNECE zip (e.g. `d19a.zip`) into `untdid/` and running
`npm run build:specs`.

## Usage

```bash
npm install
npm run build            # generates specs/ from untdid/*.zip, compiles to dist/

npx edifact-excel to-excel baplie.edi baplie.xlsx       # EDIFACT -> Excel
npx edifact-excel to-edi   baplie.xlsx baplie.edi       # Excel -> EDIFACT
npx edifact-excel validate baplie.edi                   # structure + data element validation
npx edifact-excel list                                  # bundled directories / messages
```

Options: `--directory D21B`, `--all-segments` (add columns for segments that are absent, handy
for data entry), `--no-recalculate` (keep UNT/UNE/UNZ counts as typed), `--strict` (exit code 2
on validation errors).

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { ediToExcel, excelToEdi, formatIssue } from 'edifact-excel-transformer';

const { xlsx, issues } = await ediToExcel(readFileSync('baplie.edi'));
issues.forEach((i) => console.log(formatIssue(i)));
writeFileSync('baplie.xlsx', xlsx);

const { edi, bytes } = await excelToEdi(readFileSync('baplie.xlsx'));
writeFileSync('baplie.edi', bytes); // encoded per UNB syntax identifier (ISO 8859-1 / UTF-8)
```

Lower-level building blocks are exported too: `parseInterchange`, `serializeInterchange`,
`analyseInterchange` (structure + validation), `buildMessageTree`, `validateSegment`,
`SpecRegistry`, `interchangeToWorkbook`, `workbookToInterchange`.

## Workbook layout

One sheet per level of the UN segment table:

| Sheet | Content |
|-------|---------|
| `Info` | UNA delimiters, layout version, list of messages, editing notes |
| `Interchange` | UNB and UNZ |
| `Groups` | UNG/UNE (only when functional groups are used) |
| `BAPLIE` | message level segments (UNH, BGM, DTM, UNS, ..., UNT), one row per message |
| `BAPLIE SG6`, `BAPLIE SG7`, ... | one sheet per segment group, one row per group occurrence |
| `Issues` | validation results (only when there are any) |

* **Path** (column A) links a row to its message and parent group: `M1/SG6#3/SG7#1` is the first
  SG7 of the third SG6 of message 1. In a D.21B BAPLIE, sheet `BAPLIE SG6` lists the stowage
  locations and `BAPLIE SG7` the equipment in them.
* **Column headers** name the exact position, followed by the official element name:
  `EQD 020.1 Equipment identifier` = segment EQD, data element 020 (C237), component 1 (8260).
  `MEA[2] 030.2` is the 2nd occurrence of a repeating segment, `COM[1] 010*2.1` the 2nd
  repetition of a repeating data element (syntax version 4), `LOC@0210[2]` disambiguates a tag
  used at two positions of one group. Header notes show the element tags, status and
  representation (e.g. `8260 Equipment identifier: C an..17`).
* Row 1 holds the segment captions (`EQD Equipment details (00260)`), row 2 the column keys.
* All cells are text, so leading zeros and codes such as `0010282` are preserved.

Editing: change values, delete them, or add rows with a new Path (e.g. add `M1/SG6#4` in
`BAPLIE SG6` and `M1/SG6#4/SG7#1` in `BAPLIE SG7` for a new container). Segments are written in
segment table order; group occurrences in Path order. UNT 0074, UNE 0060 and UNZ 0036 are
recalculated (and empty control references filled in) when converting back.

Conversion EDI → Excel → EDI is lossless for messages that fit their UN structure: the
EDIFACT text is reproduced byte for byte (canonical form: trailing empty elements/components
removed). Segments that do not fit the structure cannot be placed on a sheet, so `ediToExcel`
refuses such input with a `StructureError` rather than dropping data.

## Validation

`analyseInterchange` / `validate` report, with message number, segment number, group path and
element position:

* structure: unexpected segments, missing mandatory segments/groups, too many repetitions —
  matched per ISO 9735 (segments in table order, groups entered by their trigger segment, the
  innermost open group first);
* data elements per the UN segment directory: missing mandatory elements/components, too many
  elements/components/repetitions, representation (`a`, `n`, `an`, min/max length; sign and
  decimal mark not counted for numeric values);
* envelope: UNT segment count and reference, UNE/UNZ counts and references.

Code values are not checked against code lists (industry guidelines such as SMDG's add their
own codes).

## Where the specifications come from

* `untdid/d95b.zip`, `d00b.zip`, `d13b.zip`, `d16a.zip`, `d21b.zip`: the UNECE UN/EDIFACT
  directory archives (UNTDID), unmodified, with the UN licence in
  [`untdid/LICENAGR.TXT`](untdid/LICENAGR.TXT). D.21B is the most recent directory available in
  this environment (unece.org itself was not reachable; the archives were taken from the
  Smooks project's copy of the UNECE downloads,
  `smooks/smooks-edi-cartridge/edifact-schemas/src/main/resources`).
* [`scripts/build-specs.ts`](scripts/build-specs.ts) parses
  * the message specifications (`EDMD`/`TRMD` `<TYPE>_D.yyx`): header, functional definition and
    the 4.3.1 segment table, using the box drawing on the right to nest segment groups
    (incl. the code page 437 box characters of the older directories);
  * the segment directory (`EDSD`/`TRSD`): data elements, composites, components, status,
    repetition and representation;

  and writes `specs/<DIR>.json`.
* The service segments (UNB, UNG, UNH, UNT, UNS, UNE, UNZ) are not part of the batch
  directories; they come from ISO 9735 (syntax rules in UNTDID Part 4 of D.95B, with the
  additions of syntax version 4 / service directory 4.1) — see
  [`src/spec/service-segments.ts`](src/spec/service-segments.ts).

The generated D.21B structures were cross-checked against an independent parse of the same
directory (the IBM/Smooks DFDL schemas): all 18 message structures and all 42 segment
layouts match.

## Tests

```bash
npm test
```

* `test/untdid.test.ts` — directory parsing against the official segment tables;
* `test/syntax.test.ts` — UNA, release character, repetition separator, envelopes;
* `test/structure.test.ts` — segment group assignment (e.g. BAPLIE D.21B SG8 `LOC` vs SG6 `LOC`)
  and validation errors;
* `test/excel.test.ts` — EDI → Excel → EDI round trips of the samples in
  [`test/fixtures`](test/fixtures) (BAPLIE D.95B and D.21B, COPRAR D.00B, CODECO D.95B with
  functional groups, VERMAS D.16A) and of a generated message for **every container message
  of every bundled directory** containing every segment, segment group, data element,
  component and repetition; editing scenarios (changed values, added stowage location and
  container, recalculated counts) and error handling.

The samples are illustrative messages written for these tests (party, vessel and container
identifiers are fictitious); qualifier codes come from the UNCL code lists of D.21B.
