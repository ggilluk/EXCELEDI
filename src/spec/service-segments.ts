import type { ComponentDef, ElementDef, SegmentDef, Status } from './types';
import { parseFormat } from '../untdid/format';

/**
 * ISO 9735 service segments.
 *
 * The UN batch directories do not define the service segments (UNB, UNG, UNH, UNT, UNS, UNE,
 * UNZ); they are part of the syntax rules (ISO 9735). Element tags, order, status and
 * representations below follow ISO 9735 as published in UNTDID Part 4 (D.95B `D422_D.95B`,
 * "Syntax rules", annex B) with the additional trailing components and widened representations
 * of syntax version 4 (ISO 9735-2:2002, service segment directory 4.1). Syntax version 4
 * only appends optional components / elements, so these definitions validate interchanges of
 * syntax versions 2, 3 and 4.
 *
 * Where version 4 widened a representation (e.g. date 0017 n6 -> n8, segment count 0074
 * n..6 -> n..10), the wider representation is used.
 */

const c = (id: string, name: string, status: Status, format: string): ComponentDef => ({
  id,
  name,
  status,
  format: parseFormat(format),
});

const simple = (pos: string, id: string, name: string, status: Status, format: string): ElementDef => ({
  pos,
  id,
  name,
  status,
  repeat: 1,
  format: parseFormat(format),
});

const composite = (pos: string, id: string, name: string, status: Status, components: ComponentDef[]): ElementDef => ({
  pos,
  id,
  name,
  status,
  repeat: 1,
  components,
});

const S004 = (pos: string, status: Status) =>
  composite(pos, 'S004', 'Date and time of preparation', status, [
    c('0017', 'Date', 'M', 'n..8'),
    c('0019', 'Time', 'M', 'n4'),
  ]);

export const SERVICE_SEGMENTS: Record<string, SegmentDef> = {
  UNB: {
    tag: 'UNB',
    name: 'Interchange header',
    function: 'To identify an interchange.',
    elements: [
      composite('010', 'S001', 'Syntax identifier', 'M', [
        c('0001', 'Syntax identifier', 'M', 'a4'),
        c('0002', 'Syntax version number', 'M', 'an1'),
        c('0080', 'Service code list directory version number', 'C', 'an..6'),
        c('0133', 'Character encoding, coded', 'C', 'an..3'),
      ]),
      composite('020', 'S002', 'Interchange sender', 'M', [
        c('0004', 'Interchange sender identification', 'M', 'an..35'),
        c('0007', 'Identification code qualifier', 'C', 'an..4'),
        c('0008', 'Interchange sender internal identification', 'C', 'an..35'),
        c('0042', 'Interchange sender internal sub-identification', 'C', 'an..35'),
      ]),
      composite('030', 'S003', 'Interchange recipient', 'M', [
        c('0010', 'Interchange recipient identification', 'M', 'an..35'),
        c('0007', 'Identification code qualifier', 'C', 'an..4'),
        c('0014', 'Interchange recipient internal identification', 'C', 'an..35'),
        c('0046', 'Interchange recipient internal sub-identification', 'C', 'an..35'),
      ]),
      S004('040', 'M'),
      simple('050', '0020', 'Interchange control reference', 'M', 'an..14'),
      composite('060', 'S005', 'Recipient reference/password details', 'C', [
        c('0022', 'Recipient reference/password', 'M', 'an..14'),
        c('0025', 'Recipient reference/password qualifier', 'C', 'an2'),
      ]),
      simple('070', '0026', 'Application reference', 'C', 'an..14'),
      simple('080', '0029', 'Processing priority code', 'C', 'a1'),
      simple('090', '0031', 'Acknowledgement request', 'C', 'n1'),
      simple('100', '0032', 'Interchange agreement identifier', 'C', 'an..35'),
      simple('110', '0035', 'Test indicator', 'C', 'n1'),
    ],
  },
  UNZ: {
    tag: 'UNZ',
    name: 'Interchange trailer',
    function: 'To end and check the completeness of an interchange.',
    elements: [
      simple('010', '0036', 'Interchange control count', 'M', 'n..6'),
      simple('020', '0020', 'Interchange control reference', 'M', 'an..14'),
    ],
  },
  UNG: {
    tag: 'UNG',
    name: 'Group header',
    function: 'To head, identify and specify a group of messages.',
    elements: [
      simple('010', '0038', 'Message group identification', 'C', 'an..6'),
      composite('020', 'S006', 'Application sender identification', 'C', [
        c('0040', 'Application sender identification', 'M', 'an..35'),
        c('0007', 'Identification code qualifier', 'C', 'an..4'),
      ]),
      composite('030', 'S007', 'Application recipient identification', 'C', [
        c('0044', 'Application recipient identification', 'M', 'an..35'),
        c('0007', 'Identification code qualifier', 'C', 'an..4'),
      ]),
      S004('040', 'C'),
      simple('050', '0048', 'Group reference number', 'M', 'an..14'),
      simple('060', '0051', 'Controlling agency, coded', 'C', 'an..3'),
      composite('070', 'S008', 'Message version', 'C', [
        c('0052', 'Message version number', 'M', 'an..3'),
        c('0054', 'Message release number', 'M', 'an..3'),
        c('0057', 'Association assigned code', 'C', 'an..6'),
      ]),
      simple('080', '0058', 'Application password', 'C', 'an..14'),
    ],
  },
  UNE: {
    tag: 'UNE',
    name: 'Group trailer',
    function: 'To end and check the completeness of a group.',
    elements: [
      simple('010', '0060', 'Group control count', 'M', 'n..6'),
      simple('020', '0048', 'Group reference number', 'M', 'an..14'),
    ],
  },
  UNH: {
    tag: 'UNH',
    name: 'Message header',
    function: 'To head, identify and specify a message.',
    elements: [
      simple('010', '0062', 'Message reference number', 'M', 'an..14'),
      composite('020', 'S009', 'Message identifier', 'M', [
        c('0065', 'Message type', 'M', 'an..6'),
        c('0052', 'Message version number', 'M', 'an..3'),
        c('0054', 'Message release number', 'M', 'an..3'),
        c('0051', 'Controlling agency, coded', 'M', 'an..3'),
        c('0057', 'Association assigned code', 'C', 'an..6'),
        c('0110', 'Code list directory version number', 'C', 'an..6'),
        c('0113', 'Message type sub-function identification', 'C', 'an..6'),
      ]),
      simple('030', '0068', 'Common access reference', 'C', 'an..35'),
      composite('040', 'S010', 'Status of the transfer', 'C', [
        c('0070', 'Sequence of transfers', 'M', 'n..2'),
        c('0073', 'First and last transfer', 'C', 'a1'),
      ]),
      composite('050', 'S016', 'Message subset identification', 'C', [
        c('0115', 'Message subset identification', 'M', 'an..14'),
        c('0116', 'Message subset version number', 'C', 'an..3'),
        c('0118', 'Message subset release number', 'C', 'an..3'),
        c('0051', 'Controlling agency, coded', 'C', 'an..3'),
      ]),
      composite('060', 'S017', 'Message implementation guideline identification', 'C', [
        c('0121', 'Message implementation guideline identification', 'M', 'an..14'),
        c('0122', 'Message implementation guideline version number', 'C', 'an..3'),
        c('0124', 'Message implementation guideline release number', 'C', 'an..3'),
        c('0051', 'Controlling agency, coded', 'C', 'an..3'),
      ]),
      composite('070', 'S018', 'Scenario identification', 'C', [
        c('0127', 'Scenario identification', 'M', 'an..14'),
        c('0128', 'Scenario version number', 'C', 'an..3'),
        c('0130', 'Scenario release number', 'C', 'an..3'),
        c('0051', 'Controlling agency, coded', 'C', 'an..3'),
      ]),
    ],
  },
  UNT: {
    tag: 'UNT',
    name: 'Message trailer',
    function: 'To end and check the completeness of a message.',
    elements: [
      simple('010', '0074', 'Number of segments in a message', 'M', 'n..10'),
      simple('020', '0062', 'Message reference number', 'M', 'an..14'),
    ],
  },
  UNS: {
    tag: 'UNS',
    name: 'Section control',
    function: 'To separate header, detail and summary sections of a message.',
    elements: [simple('010', '0081', 'Section identification', 'M', 'a1')],
  },
};
