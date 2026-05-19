/**
 * One-shot reset: clear stale `_perfUnworkedPenaltyFiredAt` stamps on any
 * requirement that's no longer in "New Working" status.
 *
 * Why
 * ───
 * The unworked-requirement penalty was monotonic from 2026-05-14 (when the
 * event-timestamp model landed) until 2026-05-15, when product flipped it
 * to be the ONE non-monotonic penalty: the moment a marketer moves a
 * stuck "New Working" req forward, the −1 should disappear from every
 * leaderboard window.
 *
 * The clear-on-remediation hooks in `requirementController.updateRequirement`
 * and `utils/syncRequirementStatus.ts` only fire on *future* status
 * transitions. Reqs that were already worked on between 05-14 and 05-15
 * still carry the stamp, so the penalty stays parked in past leaderboards.
 * This migration sweeps those up.
 *
 * What it does
 * ─────────────
 * Single `updateMany`:
 *   - WHERE reqStatus != "New Working"
 *     AND _perfUnworkedPenaltyFiredAt exists
 *   - $unset _perfUnworkedPenaltyFiredAt
 *
 * Reqs still sitting in "New Working" are NOT touched — their penalty is
 * legitimate (they really are stuck) and the cron continues to manage
 * future transitions.
 *
 * Run with
 * ────────
 *   npm run migrate:reset-unworked-penalty
 *
 * Idempotent — a second run matches no docs (the `$exists: true` guard
 * already filtered out the cleaned ones).
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import dns from "dns";

dotenv.config();
// Same DNS pin as app.ts — keeps the migration runnable on machines
// where the system resolver refuses SRV lookups.
dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);

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

  console.log(
    "Clearing _perfUnworkedPenaltyFiredAt on reqs no longer in 'New Working'…",
  );

  const result = (await reqs.updateMany(
    {
      reqStatus: { $ne: "New Working" },
      _perfUnworkedPenaltyFiredAt: { $exists: true },
    },
    { $unset: { _perfUnworkedPenaltyFiredAt: 1 } },
  )) as { modifiedCount?: number; nModified?: number; n?: number };

  // Mongo drivers differ across versions on the result shape. Fall back
  // through the known fields so the log is useful either way.
  const cleared =
    result.modifiedCount ?? result.nModified ?? result.n ?? 0;

  console.log(`\nReset complete. Stamps cleared: ${cleared}`);

  // Sanity: how many reqs are still legitimately stamped (currently stuck)?
  const stillStuck = await reqs.countDocuments({
    reqStatus: "New Working",
    _perfUnworkedPenaltyFiredAt: { $exists: true },
  });
  console.log(
    `Still-stuck reqs retaining the penalty (correctly): ${stillStuck}`,
  );

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Migration failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
