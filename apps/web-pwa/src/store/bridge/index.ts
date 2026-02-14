export {
  generateBriefDocId,
  generateProposalScaffoldId,
  generateTalkingPointsId,
  generateElevationArtifacts,
  type ElevationContext,
} from './elevationArtifacts';

export {
  isElevationEnabled,
  checkNominationBudget,
  executeNomination,
  type BudgetPreflightResult,
  type NominationResult,
} from './nominationFlow';

export {
  getDirectory,
  loadDirectory,
  isNewerVersion,
  findRepresentatives,
  findRepresentativesByState,
  _resetDirectoryForTesting,
} from './representativeDirectory';

export {
  idbGet,
  idbSet,
  idbDelete,
  actionsKey,
  receiptsKey,
  reportsKey,
  profileKey,
  encryptLocal,
  decryptLocal,
  saveUserProfile,
  loadUserProfile,
  _resetDbForTesting,
  type UserProfile,
} from './bridgeStorage';

export {
  hydrateBridgeStore,
  isHydrated,
  getAction,
  getAllActions,
  createAction,
  updateAction,
  getReceipt,
  getAllReceipts,
  getReceiptsForAction,
  addReceipt,
  getReportPointer,
  addReportPointer,
  _resetStoreForTesting,
} from './useBridgeStore';

export {
  generateReport,
  _buildReportHtmlForTesting,
  type ReportPayload,
  type ReportResult,
} from './reportGenerator';

export {
  openMailto,
  openTel,
  openShareSheet,
  exportReportFile,
  openContactPage,
  openDeliveryChannel,
  type DeliveryChannelResult,
} from './intentAdapters';

export {
  createReceipt,
  retryReceipt,
  type ReceiptOutcome,
} from './receiptManager';
