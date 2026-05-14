/**
 * One-shot migration: backfill the monotonic performance-event timestamps
 * (`_perf*At` fields) onto every existing requirement and interview.
 *
 * Why
 * ───
 * The scoring system used to recompute from current state on every read.
 * It now reads inline event timestamps so a point awarded in May stays in
 * May's leaderboard even after the underlying doc moves further forward.
 * Existing docs predate the stamping hooks, so we seed their timestamps
 * from `updatedAt` (a defensible "last we touched this state" anchor).
 *
 * What it does
 * ─────────────
 * For every Requirement:
 *   - status ∈ Submitted / Interviewed / Project Active / Project Inactive
 *     → set `_perfSubmittedAt` (if null) to `updatedAt`.
 *   - status ∈ Interviewed / Project Active → also set `_perfInterviewedAt`.
 *   - status === "Project Active" → also set `_perfProjectActiveAt`.
 *   - status === "Project Inactive" → also set `_perfProjectInactiveAt`.
 *
 * For every Client Interview:
 *   - status === "Interview Confirm" → set `_perfConfirmedAt` (if null).
 *   - status === "Interview Completed" → set BOTH `_perfConfirmedAt` and
 *     `_perfCompletedAt` (if null) — Complete implies prior Confirm.
 *   - intResult === "Offer" → set `_perfOfferAt` (if null).
 *
 * Penalty fields (_perfStale*FiredAt, _perfUnworkedPenaltyFiredAt,
 * _perfUnprogressedPenaltyFiredAt) are NOT backfilled — penalties only
 * fire going forward via the daily cron. Past leaderboards lose their
 * previously-derived penalties, which were already flickering on/off as
 * marketers acted on the reqs (the bug being fixed).
 *
 * Run with
 * ────────
 *   npm run migrate:perf-timestamps
 *
 * Idempotent — every $set uses an `{ $exists: false }` predicate, so a
 * second run touches nothing. Safe to re-run.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import dns from "dns";

dotenv.config();
// Same DNS pin as app.ts — keeps the migration runnable on machines
// where the system resolver refuses SRV lookups.
dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);

const SUBMITTED_OR_BEYOND = [
  "Submitted",
  "Interviewed",
  "Project Active",
  "Project Inactive",
];
const INTERVIEWED_OR_BEYOND = ["Interviewed", "Project Active"];

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
  const reqs = db.collection("requirements");
  const ivs = db.collection("interviews");

  console.log("Backfilling requirements…");

  // _perfSubmittedAt for everything that ever reached SUBMITTED_OR_BEYOND
  const subRes = await reqs.updateMany(
    {
      reqStatus: { $in: SUBMITTED_OR_BEYOND },
      _perfSubmittedAt: { $exists: false },
    },
    [
      // Pipeline-style $set so we can reference `$updatedAt` per document.
      { $set: { _perfSubmittedAt: "$updatedAt" } },
    ],
  );

  // _perfInterviewedAt for everything that ever reached INTERVIEWED_OR_BEYOND
  const intRes = await reqs.updateMany(
    {
      reqStatus: { $in: INTERVIEWED_OR_BEYOND },
      _perfInterviewedAt: { $exists: false },
    },
    [{ $set: { _perfInterviewedAt: "$updatedAt" } }],
  );

  // _perfProjectActiveAt
  const paRes = await reqs.updateMany(
    {
      reqStatus: "Project Active",
      _perfProjectActiveAt: { $exists: false },
    },
    [{ $set: { _perfProjectActiveAt: "$updatedAt" } }],
  );

  // _perfProjectInactiveAt
  const piRes = await reqs.updateMany(
    {
      reqStatus: "Project Inactive",
      _perfProjectInactiveAt: { $exists: false },
    },
    [{ $set: { _perfProjectInactiveAt: "$updatedAt" } }],
  );

  console.log("Backfilling client interviews…");

  // Confirm: interview is currently Confirm OR Completed (Complete implies
  // prior Confirm). Only client interviews.
  const confRes = await ivs.updateMany(
    {
      interviewWith: "Client",
      interviewStatus: { $in: ["Interview Confirm", "Interview Completed"] },
      _perfConfirmedAt: { $exists: false },
    },
    [{ $set: { _perfConfirmedAt: "$updatedAt" } }],
  );

  // Completed
  const compRes = await ivs.updateMany(
    {
      interviewWith: "Client",
      interviewStatus: "Interview Completed",
      _perfCompletedAt: { $exists: false },
    },
    [{ $set: { _perfCompletedAt: "$updatedAt" } }],
  );

  // Offer result
  const offRes = await ivs.updateMany(
    {
      interviewWith: "Client",
      intResult: "Offer",
      _perfOfferAt: { $exists: false },
    },
    [{ $set: { _perfOfferAt: "$updatedAt" } }],
  );

  console.log("\nBackfill complete:");
  console.log({
    requirements: {
      submittedAt: subRes.modifiedCount ?? (subRes as { nModified?: number }).nModified ?? 0,
      interviewedAt: intRes.modifiedCount ?? (intRes as { nModified?: number }).nModified ?? 0,
      projectActiveAt: paRes.modifiedCount ?? (paRes as { nModified?: number }).nModified ?? 0,
      projectInactiveAt: piRes.modifiedCount ?? (piRes as { nModified?: number }).nModified ?? 0,
    },
    interviews: {
      confirmedAt: confRes.modifiedCount ?? (confRes as { nModified?: number }).nModified ?? 0,
      completedAt: compRes.modifiedCount ?? (compRes as { nModified?: number }).nModified ?? 0,
      offerAt: offRes.modifiedCount ?? (offRes as { nModified?: number }).nModified ?? 0,
    },
  });

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Migration failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
