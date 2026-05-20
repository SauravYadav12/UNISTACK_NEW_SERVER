/**
 * One-shot cleanup: delete duplicate notification rows that share the same
 * (recipientRef, dedupeKey) within the same calendar day.
 *
 * Why
 * ───
 * `emitNotification`'s dedupe check is read-then-write — two emit calls
 * that race the read can both pass and both insert, leaving the user with
 * two identical bell rows (e.g. the "Interview today: INT-09 (Vendor)"
 * pair you saw in the bug screenshot).
 *
 * We're about to add a partial unique index on (recipientRef, dedupeKey)
 * to make duplicates DB-impossible going forward. Mongo can't build a
 * unique index on a collection that already has duplicates — this script
 * cleans them up first, so the index build succeeds. Run this BEFORE
 * deploying the model change that adds the index.
 *
 * What it does
 * ─────────────
 * 1. Aggregate notifications grouped by
 *    (recipientRef, dedupeKey, day(createdAt)) where dedupeKey is a
 *    non-null string.
 * 2. For any group with >1 row, keep the earliest `_id` (first one
 *    delivered), delete the rest.
 *
 * Notifications WITHOUT a dedupeKey (the dominant category — assign,
 * leave, salary, interview events) are not touched. The new index will
 * not constrain them either.
 *
 * Idempotent — second run finds no groups with >1 row and deletes 0.
 *
 * Run with
 * ────────
 *   npm run migrate:dedupe-notifications
 *
 * Roll-out order
 * ──────────────
 *   1. Run this migration first (cleanup).
 *   2. Deploy the model change (adds the partial unique index).
 *   3. Re-run this migration once more for safety (idempotent).
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import dns from "dns";

dotenv.config();
// Same DNS pin as app.ts.
dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);

interface DupGroup {
  _id: {
    recipientRef: mongoose.Types.ObjectId;
    dedupeKey: string;
    day: string;
  };
  ids: mongoose.Types.ObjectId[];
  createdAts: Date[];
}

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
  const notifications = db.collection("notifications");

  console.log(
    "Scanning notifications for (recipient, dedupeKey, day) duplicates…",
  );

  // Group by (recipient, dedupeKey, day-of-creation). Day bucket is the
  // YYYY-MM-DD slice of createdAt in UTC — close enough for dedupe semantic
  // (the existing dedupe-key check uses a 24h window anyway). Returns one
  // doc per group with the array of duplicate _ids + their createdAt.
  const groups: DupGroup[] = await notifications
    .aggregate([
      {
        $match: {
          dedupeKey: { $type: "string" },
        },
      },
      {
        $group: {
          _id: {
            recipientRef: "$recipientRef",
            dedupeKey: "$dedupeKey",
            day: {
              $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
            },
          },
          ids: { $push: "$_id" },
          createdAts: { $push: "$createdAt" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
    ])
    .toArray() as DupGroup[];

  console.log(`Found ${groups.length} duplicate groups.`);

  let totalDeleted = 0;
  for (const g of groups) {
    // Sort by createdAt asc — keep the earliest, delete the rest. Using
    // _id-paired createdAt so we preserve which doc to keep.
    const paired = g.ids.map((id, i) => ({ id, createdAt: g.createdAts[i] }));
    paired.sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const keep = paired.shift(); // earliest — the "real" notification
    if (!keep) continue;
    const dropIds = paired.map((p) => p.id);
    if (dropIds.length === 0) continue;

    const res = await notifications.deleteMany({ _id: { $in: dropIds } });
    totalDeleted += res.deletedCount ?? 0;
  }

  console.log(`\nCleanup complete. Deleted ${totalDeleted} duplicate rows.`);
  console.log(
    `Kept the earliest entry of each group — bell history preserved for the legitimate delivery.`,
  );

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Migration failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
