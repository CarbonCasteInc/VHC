/**
 * Beta invite gating configuration.
 * Kill switch + environment config for closed testnet.
 *
 * VITE_INVITE_ONLY_ENABLED controls invite-only mode (default: true).
 * Admin kill switch overrides env var via localStorage.
 */
import { safeGetItem, safeSetItem } from '../../utils/safeStorage';

const KILL_SWITCH_KEY = 'vh_invite_kill_switch';

/** Read VITE_INVITE_ONLY_ENABLED env var (default: true for testnet). */
export function isInviteOnlyEnabled(): boolean {
  const killSwitch = safeGetItem(KILL_SWITCH_KEY);
  if (killSwitch === 'disabled') return false;
  if (killSwitch === 'enabled') return true;

  const envVal = import.meta.env.VITE_INVITE_ONLY_ENABLED;
  if (envVal === 'false') return false;
  return true;
}

/** Admin kill switch: instantly disable/enable invite gating. */
export function setKillSwitch(enabled: boolean): void {
  safeSetItem(KILL_SWITCH_KEY, enabled ? 'enabled' : 'disabled');
}

/** Clear kill switch override (revert to env var). */
export function clearKillSwitch(): void {
  safeSetItem(KILL_SWITCH_KEY, '');
}

/** Get current kill switch state. */
export function getKillSwitchState(): 'enabled' | 'disabled' | 'default' {
  const val = safeGetItem(KILL_SWITCH_KEY);
  if (val === 'enabled') return 'enabled';
  if (val === 'disabled') return 'disabled';
  return 'default';
}
