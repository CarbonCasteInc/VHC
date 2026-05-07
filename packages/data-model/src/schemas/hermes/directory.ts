import { z } from 'zod';

export const DIRECTORY_ENTRY_PROTOCOL_VERSION = 'luma-public-v1';
export const DIRECTORY_ENTRY_AUTHOR_SCHEME = 'identity-directory-v1';
export const DIRECTORY_ENTRY_WRITER_KIND = 'luma';
export const DIRECTORY_ENTRY_AUDIENCE = 'vh-directory-entry';

const LowerHex64Schema = z.string().regex(/^[0-9a-f]{64}$/);
const LowerHex32Schema = z.string().regex(/^[0-9a-f]{32}$/);

export const DelegationSigningPublicKeySchema = z.object({
  signatureSuite: z.literal('jcs-ed25519-sha256-v1'),
  publicKey: z.object({
    encoding: z.literal('base64url'),
    material: z.string().min(1)
  }).strict(),
  createdAt: z.number().int().nonnegative()
}).strict();

export const LegacyDirectoryEntrySchema = z.object({
  schemaVersion: z.literal('hermes-directory-v0'),
  nullifier: z.string().min(1),
  devicePub: z.string().min(1),
  epub: z.string().min(1),
  displayName: z.string().optional(),
  delegationSigningPublicKey: DelegationSigningPublicKeySchema.optional(),
  registeredAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative()
}).strict();

export const DirectoryEntryPayloadSchema = z.object({
  schemaVersion: z.literal('hermes-directory-v1'),
  _protocolVersion: z.literal(DIRECTORY_ENTRY_PROTOCOL_VERSION),
  _writerKind: z.literal(DIRECTORY_ENTRY_WRITER_KIND),
  _authorScheme: z.literal(DIRECTORY_ENTRY_AUTHOR_SCHEME),
  identityDirectoryKey: LowerHex64Schema,
  devicePub: z.string().min(1),
  epub: z.string().min(1),
  displayName: z.string().optional(),
  delegationSigningPublicKey: DelegationSigningPublicKeySchema.optional(),
  registeredAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative()
}).strict();

export const DirectorySignedWriteSessionRefSchema = z.object({
  tokenHash: z.string().min(1),
  envelopeDigest: z.string().min(1)
}).strict();

export const DirectorySignedWriteEnvelopeSchema = z.object({
  envelopeVersion: z.literal(1),
  signatureSuite: z.literal('jcs-ed25519-sha256-v1'),
  protocolVersion: z.literal('luma-write-v1'),
  profile: z.enum(['dev', 'e2e', 'public-beta', 'production-attestation']),
  audience: z.literal(DIRECTORY_ENTRY_AUDIENCE),
  origin: z.string().min(1),
  scheme: z.literal(DIRECTORY_ENTRY_AUTHOR_SCHEME),
  publicAuthor: LowerHex64Schema,
  sessionRef: DirectorySignedWriteSessionRefSchema,
  payload: DirectoryEntryPayloadSchema,
  payloadDigest: LowerHex64Schema,
  sequence: z.number().int().nonnegative(),
  nonce: LowerHex32Schema,
  idempotencyKey: LowerHex64Schema,
  issuedAt: z.number().int().nonnegative(),
  signature: z.string().min(1)
}).strict();

export const DirectoryEntrySchema = DirectoryEntryPayloadSchema.extend({
  signedWriteEnvelope: DirectorySignedWriteEnvelopeSchema
}).strict();

export const DirectoryLookupEntrySchema = z.union([
  DirectoryEntrySchema,
  LegacyDirectoryEntrySchema
]);

export type DelegationSigningPublicKey = z.infer<typeof DelegationSigningPublicKeySchema>;
export type LegacyDirectoryEntry = z.infer<typeof LegacyDirectoryEntrySchema>;
export type DirectoryEntryPayload = z.infer<typeof DirectoryEntryPayloadSchema>;
export type DirectorySignedWriteSessionRef = z.infer<typeof DirectorySignedWriteSessionRefSchema>;
export type DirectorySignedWriteEnvelope = z.infer<typeof DirectorySignedWriteEnvelopeSchema>;
export type DirectoryEntry = z.infer<typeof DirectoryEntrySchema>;
export type DirectoryLookupEntry = z.infer<typeof DirectoryLookupEntrySchema>;
