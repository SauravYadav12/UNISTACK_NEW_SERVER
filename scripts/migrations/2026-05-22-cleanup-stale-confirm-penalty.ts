/**
 * One-shot cleanup: remove `_perfStaleConfirmFiredAt` stamps that were
 * fired under the OLD stale-confirm rule and no longer satisfy the new
 * one.
 *
 * Background
 * ──────────
 * Until 2026-05-21, the daily `performanceWarningScheduler` decided
 * stale-confirmed-interview penalties by comparing the *scheduled*
 * `interviewDate` (a free-form string field marketers type in) against
 * `now − STALE_CONFIRM_DAYS`. Two bugs followed:
 *
 *   1. The job didn't filter on `interviewWith` — every confirmed
 *      interview (Client, Vendor, IMP) could end up stamped.
 *   2. A marketer logging an already-occurred interview by setting
 *      `interviewDate` to a past date would instantly look "stale" to
 *      the cron, even though the confirmation just happened today.
 *      Real example we're cleaning up after: INT-10 (Client, REQ-110A)
 *      was created 2026-05-20 and stamped the same week.
 *
 * The new rule (live since 2026-05-21):
 *   - Only Client interviews count.
 *   - Staleness is measured from `_perfConfirmedAt` (the moment the
 *     interview FIRST entered "Interview Confirm"), which is itself
 *     monotonic and trustworthy.
 *
 * The forward-going cron now does the right thing, but the stamps
 * placed by the old logic survive (penalty timestamps are monotonic by
 * design). This migration retroactively unsets stamps that the new
 * rule wouldn't have fired:
 *
 *   (A) `interviewWith !== "Client"`            — always wrong.
 *   (B) `_perfConfirmedAt` missing               — never legitimately
 *                                                   confirmed under the
 *                                                   monotonic model.
 *   (C) `_perfStaleConfirmFiredAt − _perfConfirmedAt < threshold`
 *                                               — fired before the
 *                                                   14-day clock from
 *                                                   actual confirmation
 *                                                   elapsed.
 *
 * Stamps that DO still satisfy the new rule (Client + ≥14 days since
 * `_perfConfirmedAt`) are kept — those penalties remain legitimate.
 *
 * Threshold is read live from `performanceweights` (marketing role) so
 * if an admin has tuned `STALE_CONFIRM_DAYS`, this migration follows
 * the same value the cron uses. Falls back to 14 if the doc is absent.
 *
 * Run with
 * ────────
 *   npm run migrate:cleanup-stale-confirm
 *
 * Idempotent — second run matches no docs (the three predicates are
 * disjoint from the post-cleanup state).
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import dns from "dns";

dotenv.config();
// Same DNS pin as app.ts — keeps the migration runnable on machines
// where the system resolver refuses SRV lookups.
dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);

const FALLBACK_STALE_CONFIRM_DAYS = 14;

async function run() {
  const password = process.env.DATABASE_PASSWORD || "";
  const uri = (process.env.DATABASE || "").replace("<PASSWORD>", password);
  if (!uri) {
    console.error("DATABASE env var is empty — aborting.");
    process.exit(1);
  }

  console.log("Connecting…");
  await mongoose.connect(uri, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useFindAndModify: false,
    useUnifiedTopology: true,
  } as mongoose.ConnectionOptions);

  const db = mongoose.connection.db;
  const interviews = db.collection("interviews");
  const weights = db.collection("performanceweights");

  // Resolve the live threshold so we honor any admin tuning.
  const weightsDoc = (await weights.findOne({ role: "marketing" })) as
    | { weights?: Record<string, number> }
    | null;
  const staleConfirmDays =
    weightsDoc?.weights?.STALE_CONFIRM_DAYS ?? FALLBACK_STALE_CONFIRM_DAYS;
  const thresholdMs = staleConfirmDays * 24 * 60 * 60 * 1000;
  console.log(
    `Using STALE_CONFIRM_DAYS=${staleConfirmDays} (${thresholdMs} ms).`,
  );

  // ── Pass A: non-Client interviews — penalty should never apply ──
  const passA = (await interviews.updateMany(
    {
      _perfStaleConfirmFiredAt: { $exists: true },
      interviewWith: { $ne: "Client" },
    },
    { $unset: { _perfStaleConfirmFiredAt: 1 } },
  )) as { modifiedCount?: number; nModified?: number; n?: number };
  const clearedA = passA.modifiedCount ?? passA.nModified ?? passA.n ?? 0;
  console.log(`Pass A (non-Client): cleared ${clearedA}.`);

  // ── Pass B: stamp present but `_perfConfirmedAt` missing ──
  // Under the new rule we cannot establish a 14-day clock without a
  // trustworthy first-confirm timestamp, so these are unsafe.
  const passB = (await interviews.updateMany(
    {
      _perfStaleConfirmFiredAt: { $exists: true },
      _perfConfirmedAt: { $exists: false },
    },
    { $unset: { _perfStaleConfirmFiredAt: 1 } },
  )) as { modifiedCount?: number; nModified?: number; n?: number };
  const clearedB = passB.modifiedCount ?? passB.nModified ?? passB.n ?? 0;
  console.log(`Pass B (no _perfConfirmedAt): cleared ${clearedB}.`);

  // ── Pass C: gap between fire and confirm is below the threshold ──
  // i.e. the old `interviewDate`-based logic fired well before 14 real
  // days had elapsed since the actual confirmation. This is the INT-10
  // case.
  const passC = (await interviews.updateMany(
    {
      _perfStaleConfirmFiredAt: { $exists: true },
      _perfConfirmedAt: { $exists: true },
      $expr: {
        $lt: [
          { $subtract: ["$_perfStaleConfirmFiredAt", "$_perfConfirmedAt"] },
          thresholdMs,
        ],
      },
    },
    { $unset: { _perfStaleConfirmFiredAt: 1 } },
  )) as { modifiedCount?: number; nModified?: number; n?: number };
  const clearedC = passC.modifiedCount ?? passC.nModified ?? passC.n ?? 0;
  console.log(`Pass C (fire − confirm < threshold): cleared ${clearedC}.`);

  console.log(`\nTotal stamps cleared: ${clearedA + clearedB + clearedC}.`);

  // Sanity counters.
  const remainingStamped = await interviews.countDocuments({
    _perfStaleConfirmFiredAt: { $exists: true },
  });
  const remainingLegit = await interviews.countDocuments({
    _perfStaleConfirmFiredAt: { $exists: true },
    interviewWith: "Client",
    _perfConfirmedAt: { $exists: true },
  });
  console.log(`Stamps remaining (any): ${remainingStamped}.`);
  console.log(
    `Stamps remaining (Client + _perfConfirmedAt present, i.e. legit): ${remainingLegit}.`,
  );

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Migration failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
