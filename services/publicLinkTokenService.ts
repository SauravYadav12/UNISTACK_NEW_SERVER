/**
 * Public-link token service — issue / validate / revoke crypto-random
 * tokens used by onboarding magic links. Everything that touches
 * `PublicLinkTokenModel` from controllers flows through here so the
 * rules (expiry, single-use, revocation) live in one place.
 *
 * Token format: 32-byte hex via `crypto.randomBytes(32).toString('hex')`
 * = 64 chars. URL-safe by construction. No collision-risk concern at
 * this volume.
 */

import crypto from "crypto";
import { Types } from "mongoose";
import {
  PublicLinkTokenModel,
  PublicLinkTokenDoc,
  PublicLinkPurpose,
} from "../models/publicLinkTokenModel";

const DEFAULT_EXPIRY_DAYS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function generateRawToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Issue a fresh token for `(candidateRef, purpose)`. Revokes any
 * existing un-consumed tokens of the same purpose for that candidate
 * first — admins shouldn't accidentally end up with two live links
 * (e.g. after a "resend link" click).
 */
export async function issuePublicLinkToken(args: {
  candidateRef: Types.ObjectId | string;
  purpose: PublicLinkPurpose;
  expiryDays?: number;
}): Promise<PublicLinkTokenDoc> {
  const candidateId =
    typeof args.candidateRef === "string"
      ? new Types.ObjectId(args.candidateRef)
      : args.candidateRef;

  // Revoke previous live tokens of this purpose for the same candidate.
  // Side-effect on purpose: if HR clicks "resend link", the old URL
  // becomes invalid the moment the new one is issued — matches
  // operator expectations.
  await PublicLinkTokenModel.updateMany(
    {
      candidateRef: candidateId,
      purpose: args.purpose,
      consumedAt: { $exists: false },
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: new Date() } },
  );

  const expiresAt = new Date(
    Date.now() + (args.expiryDays ?? DEFAULT_EXPIRY_DAYS) * MS_PER_DAY,
  );

  const doc = await PublicLinkTokenModel.create({
    token: generateRawToken(),
    purpose: args.purpose,
    candidateRef: candidateId,
    expiresAt,
  });
  return doc;
}

export type TokenValidationResult =
  | {
      ok: true;
      token: PublicLinkTokenDoc;
    }
  | {
      ok: false;
      reason: "not-found" | "expired" | "consumed" | "revoked";
    };

/**
 * Validate a raw token from a URL. Returns the doc on success or a
 * tagged failure reason. Callers map the reason to a stable HTTP
 * response — see `publicOnboardingController.resolveToken`.
 */
export async function validatePublicLinkToken(
  rawToken: string,
  expectedPurpose?: PublicLinkPurpose,
): Promise<TokenValidationResult> {
  if (!rawToken || rawToken.length !== 64) {
    return { ok: false, reason: "not-found" };
  }
  const filter: Record<string, unknown> = { token: rawToken };
  if (expectedPurpose) filter.purpose = expectedPurpose;
  const doc = await PublicLinkTokenModel.findOne(filter);
  if (!doc) return { ok: false, reason: "not-found" };
  if (doc.revokedAt) return { ok: false, reason: "revoked" };
  if (doc.consumedAt) return { ok: false, reason: "consumed" };
  if (doc.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, token: doc };
}

/**
 * Mark a token consumed — called from the public controller AFTER the
 * candidate's submit (form / sign-offer) succeeds. Idempotent.
 */
export async function consumePublicLinkToken(
  tokenId: Types.ObjectId,
): Promise<void> {
  await PublicLinkTokenModel.updateOne(
    { _id: tokenId, consumedAt: { $exists: false } },
    { $set: { consumedAt: new Date() } },
  );
}
