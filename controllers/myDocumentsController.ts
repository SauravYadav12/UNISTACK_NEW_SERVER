import { Request, Response } from "express";
import { FilterQuery } from "mongoose";
import { OnboardingCandidateModel } from "../models/onboardingCandidateModel";
import { UserProfileModel } from "../models/userProfileModel";
import { UserDoc } from "../models/userModel";

/**
 * GET /my-documents/onboarding
 *
 * Resolves the calling user's signed onboarding documents — offer letter +
 * additional signed docs (Employment Agreement / Code of Conduct / NDA /
 * Leave Policy) — by matching on email across:
 *   - User.email (the candidate's portal login)
 *   - UserProfile.email.personal
 *   - UserProfile.email.official
 *
 * The match is done lazily at view time so this works for BOTH new
 * employees onboarded post-launch AND existing employees who were
 * already onboarded before the My Documents → Onboarding feature
 * shipped. No schema migration, no admin link step.
 *
 * On `hasOnboarding: false` the client renders an empty-state card
 * suggesting the user reach out to HR to verify the email on file.
 */
export const getMyOnboardingDocs = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc | undefined;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const profileFilter = { user: user._id } as FilterQuery<
      Record<string, unknown>
    >;
    const profile = await UserProfileModel.findOne(profileFilter)
      .select("email")
      .lean();

    const emails = new Set<string>();
    if (user.email) emails.add(String(user.email).toLowerCase());
    const profileEmail = (profile as { email?: { personal?: string; official?: string } } | null)?.email;
    if (profileEmail?.personal) emails.add(profileEmail.personal.toLowerCase());
    if (profileEmail?.official) emails.add(profileEmail.official.toLowerCase());

    if (emails.size === 0) {
      res.status(200).json({ data: { hasOnboarding: false } });
      return;
    }

    // Pick the most recent candidate to gracefully handle a rehire case
    // (same email used for two distinct onboarding cycles).
    const candidate = await OnboardingCandidateModel.findOne({
      email: { $in: Array.from(emails) },
      stage: { $in: ["onboarded", "offer-signed"] },
    })
      .sort({ updatedAt: -1 })
      .lean();

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
    console.error("[my-documents] Failed to resolve onboarding docs:", (error as Error).message);
    res.status(500).json({ error: "Failed to load onboarding documents" });
  }
};
