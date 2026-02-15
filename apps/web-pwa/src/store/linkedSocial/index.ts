/**
 * Linked Social store barrel.
 *
 * IMPORTANT: OAuthTokenRecord and tokenVault internals are NOT exported
 * from this barrel. They are vault-only and must be imported directly
 * from './tokenVault' by code that legitimately needs vault access.
 */

// Account state management
export {
  connectAccount,
  disconnectAccount,
  getAccount,
  getAllAccounts,
  getAccountsByProvider,
  ingestNotification,
  setNotificationIngestedHandler,
  getNotification,
  getAllNotifications,
  getNotificationsByAccount,
  markSeen,
  dismissNotification,
  toSanitizedCard,
  findForbiddenField,
  FORBIDDEN_PUBLIC_FIELDS,
  _resetStoreForTesting,
  _setFeatureFlagForTesting,
} from './accountStore';

export type { SanitizedSocialCard } from './accountStore';

// Social → Feed adapter
export {
  notificationToFeedItem,
  getSocialFeedItems,
  isLinkedSocialFeedEnabled,
  _setFlagForTesting,
} from './socialFeedAdapter';

// Mock factories (for downstream consumers / tests)
export {
  createMockNotification,
  createMockAccount,
  createMockToken,
  _resetMockCounter,
} from './mockFactories';
