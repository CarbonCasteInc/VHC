import {
  NEWS_REPORT_AUDIENCE,
  NEWS_REPORT_AUTHOR_SCHEME,
  NEWS_REPORT_PUBLIC_PROTOCOL_VERSION,
  NEWS_REPORT_WRITER_KIND,
  type HermesNewsReportV2,
  type HermesNewsReportReasonCode,
  type HermesNewsReportSignedPayload,
  type HermesNewsReportTarget
} from '@vh/data-model';
import {
  createLumaPublicAuthorId,
  createSignedWriteEnvelope,
  type DeploymentProfile
} from '@vh/luma-sdk';
import { signWithStoredDelegationSigningKey } from '@vh/identity-vault';
import { deriveForumAuthorId, type IdentityRecord } from '@vh/types';
import {
  assertLumaForumIdentity,
  deriveForumSignedWriteSessionRef,
  lumaForumDeploymentProfile
} from './forum/lumaRecords';
import { assertCanPerformMvpAction } from '../luma/mvpActionPolicy';

interface NewsReportRecordInput {
  readonly identity: IdentityRecord | null;
  readonly reportId: string;
  readonly target: HermesNewsReportTarget;
  readonly reasonCode: HermesNewsReportReasonCode;
  readonly reason?: string;
  readonly reporterHandle?: string;
  readonly createdAt: number;
}

export async function createLumaNewsReportRecord(input: NewsReportRecordInput): Promise<HermesNewsReportV2> {
  const identity = assertLumaForumIdentity(input.identity);
  const reporterId = await deriveForumAuthorId(identity.session.nullifier);
  const profile = lumaNewsReportDeploymentProfile();
  const origin = currentOrigin();
  const payload: HermesNewsReportSignedPayload = stripUndefined({
    schemaVersion: 'hermes-news-report-v2',
    _protocolVersion: NEWS_REPORT_PUBLIC_PROTOCOL_VERSION,
    _writerKind: NEWS_REPORT_WRITER_KIND,
    _authorScheme: NEWS_REPORT_AUTHOR_SCHEME,
    report_id: input.reportId,
    target: input.target,
    reason_code: input.reasonCode,
    reason: input.reason,
    reporter_id: reporterId,
    reporter_handle: input.reporterHandle,
    created_at: input.createdAt
  });

  const signedWriteEnvelope = await createSignedWriteEnvelope({
    profile,
    audience: NEWS_REPORT_AUDIENCE,
    origin,
    scheme: NEWS_REPORT_AUTHOR_SCHEME,
    publicAuthor: createLumaPublicAuthorId(reporterId, NEWS_REPORT_AUTHOR_SCHEME),
    sessionRef: await deriveForumSignedWriteSessionRef(identity),
    payload,
    sequence: input.createdAt,
    nonce: randomNonceHex(),
    issuedAt: input.createdAt,
    sign: ({ canonicalBytes }) => signWithStoredDelegationSigningKey(canonicalBytes)
  });
  if (profile === 'public-beta') {
    await assertCanPerformMvpAction({
      identity,
      profile,
      action: NEWS_REPORT_AUDIENCE,
      envelope: signedWriteEnvelope,
      scheme: NEWS_REPORT_AUTHOR_SCHEME,
      publicAuthor: reporterId,
      origin
    });
  }

  return {
    ...payload,
    status: 'pending',
    audit: {
      action: 'news_report'
    },
    signedWriteEnvelope: {
      ...signedWriteEnvelope,
      audience: NEWS_REPORT_AUDIENCE,
      scheme: NEWS_REPORT_AUTHOR_SCHEME,
      publicAuthor: reporterId,
      payload
    }
  };
}

export function lumaNewsReportDeploymentProfile(): DeploymentProfile {
  return lumaForumDeploymentProfile();
}

function currentOrigin(): string {
  const origin = (globalThis as typeof globalThis & { location?: { origin?: string } }).location?.origin;
  return typeof origin === 'string' && origin.length > 0 ? origin : 'vh://local';
}

function randomNonceHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function stripUndefined<T>(value: T): T {
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, field]) => field !== undefined)
        .map(([key, field]) => [key, stripUndefined(field)])
    ) as T;
  }
  return value;
}
