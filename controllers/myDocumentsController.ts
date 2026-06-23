import { Request, Response } from "express";
import { FilterQuery } from "mongoose";
import { OnboardingCandidateModel } from "../models/onboardingCandidateModel";
import { UserProfileModel } from "../models/userProfileModel";
import { UserDoc } from "../models/userModel";

/**
 * GET /my-documents/onboarding
 *
 * Resolves the calling user's signed onboarding documents — offer
 * letter + additional signed docs (Employment Agreement / Code of
 * Conduct / NDA / Leave Policy).
 *
 * Resolution is a two-pass strategy:
 *
 *   1. PRIMARY — `OnboardingCandidate.officialEmail === User.email`.
 *      `officialEmail` is the HR-recorded corporate email; matching
 *      against the user's login is deterministic and single-field.
 *      This is the path HR-managed candidates take going forward.
 *
 *   2. FALLBACK — legacy 3-way match against `OnboardingCandidate.email`
 *      using `User.email`, `UserProfile.email.personal`, and
 *      `UserProfile.email.official`. Used for candidates created
 *      before `officialEmail` existed (or whose HR hasn't filled it
 *      in yet). Keeps every pre-launch onboarded employee working
 *      without a data backfill.
 *
 * On no match either way the client renders an empty-state card.
 */
export const getMyOnboardingDocs = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc | undefined;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const userEmail = user.email ? String(user.email).toLowerCase() : "";

    // ── 1. Primary match — officialEmail === User.email ──
    // Single indexed lookup. When HR has set the field, this resolves
    // in one round-trip and we skip the fallback path entirely.
    let candidate = userEmail
      ? await OnboardingCandidateModel.findOne({
          officialEmail: userEmail,
          stage: { $in: ["onboarded", "offer-signed"] },
        })
          .sort({ updatedAt: -1 })
          .lean()
      : null;

    // ── 2. Fallback — legacy 3-way email match against the invite email ──
    if (!candidate) {
      const profileFilter = { user: user._id } as FilterQuery<
        Record<string, unknown>
      >;
      const profile = await UserProfileModel.findOne(profileFilter)
        .select("email")
        .lean();

      const emails = new Set<string>();
      if (userEmail) emails.add(userEmail);
      const profileEmail = (
        profile as { email?: { personal?: string; official?: string } } | null
      )?.email;
      if (profileEmail?.personal)
        emails.add(profileEmail.personal.toLowerCase());
      if (profileEmail?.official)
        emails.add(profileEmail.official.toLowerCase());

      if (emails.size > 0) {
        candidate = await OnboardingCandidateModel.findOne({
          email: { $in: Array.from(emails) },
          stage: { $in: ["onboarded", "offer-signed"] },
        })
          .sort({ updatedAt: -1 })
          .lean();
      }
    }

    if (!candidate) {
      res.status(200).json({ data: { hasOnboarding: false } });
      return;
    }

    res.status(200).json({
      data: {
        hasOnboarding: true,
        candidate: {
          candId: candidate.candId,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          position: candidate.position,
          stage: candidate.stage,
        },
        offer: candidate.offer ?? null,
        additionalSignedDocuments: candidate.additionalSignedDocuments ?? [],
        additionalDocSnapshots: candidate.additionalDocSnapshots ?? [],
      },
    });
  } catch (error) {
    console.error(
      "[my-documents] Failed to resolve onboarding docs:",
      (error as Error).message,
    );
    res.status(500).json({ error: "Failed to load onboarding documents" });
  }
};
