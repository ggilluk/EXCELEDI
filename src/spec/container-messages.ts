/**
 * UN/EDIFACT message types concerned with containers / transport equipment.
 *
 * The list follows the scope sections of the UN message specifications themselves:
 * the messages whose section 1.1 states "This message is part of a total set of
 * container-related messages" (CALINF, COARRI, CODECO, CODENO, COEDOR, COHAOR, COPARN, COPINO,
 * COPRAR, COREOR, COSTCO, COSTOR, VESDEP), plus the messages whose functional definition is
 * about the stowage, repair, weighing or terminal handling of containers/equipment
 * (BAPLIE, MOVINS, DESTIM, TPFREP, VERMAS).
 */
export const CONTAINER_MESSAGES = [
  'BAPLIE', // Bayplan/stowage plan occupied and empty locations message
  'CALINF', // Vessel call information message
  'COARRI', // Container discharge/loading report message
  'CODECO', // Container gate-in/gate-out report message
  'CODENO', // Permit expiration/clearance ready notice message
  'COEDOR', // Transport equipment stock and profile report message
  'COHAOR', // Container special handling order message
  'COPARN', // Container announcement message
  'COPINO', // Container pre-notification message
  'COPRAR', // Container discharge/loading order message
  'COREOR', // Container release order message
  'COSTCO', // Container stuffing/stripping confirmation message
  'COSTOR', // Container stuffing/stripping order message
  'DESTIM', // Equipment damage and repair estimate message
  'MOVINS', // Stowage instruction message
  'TPFREP', // Terminal performance message
  'VERMAS', // Verified gross mass message
  'VESDEP', // Vessel departure message
] as const;

export type ContainerMessageType = (typeof CONTAINER_MESSAGES)[number];
