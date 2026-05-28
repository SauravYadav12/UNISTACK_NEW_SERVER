/**
 * One-shot backfill: sync the denormalized `Leave.type` string from
 * the referenced `LeaveType.name`.
 *
 * Background
 * ──────────
 * `Leave` has two parallel type fields:
 *   - `leaveType`: ObjectId reference to a `LeaveType` (the new system,
 *     used by the React form).
 *   - `type`: a legacy string enum with `default: "Casual Leave"`. The
 *     admin grid + email templates render this field.
 *
 * Until today's fix, the React form only sent `leaveType`, so `type`
 * fell back to its default. Result: every recent leave shows up as
 * "Casual Leave" in admin emails and the All Requests grid, regardless
 * of what the employee actually picked.
 *
 * The forward path is fixed (createLeave + updateLeave now stamp
 * `type` from `leaveType.name`). This migration cleans up the past.
 *
 * What it does
 * ────────────
 * For every `Leave` document that has a `leaveType` ref:
 *   - Look up the referenced `LeaveType`
 *   - Set `type = leaveType.name`
 *
 * Skips leaves where `leaveType` is missing (legacy data from before
 * the dynamic-types feature; the schema default is at least
 * grammatically valid for those).
 *
 * Run with
 * ────────
 *   npm run migrate:sync-leave-type-name
 *
 * Idempotent — re-running matches no changes once values converge.
 */

import mongoose from "mongoose";
import dotenv from "dotenv";
import dns from "dns";

dotenv.config();
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
  const leaves = db.collection("leaves");
  const leaveTypes = db.collection("leavetypes");

  // Build a map of typeId → name in one shot. Tiny collection, no harm.
  const typeDocs = (await leaveTypes
    .find({}, { projection: { _id: 1, name: 1 } })
    .toArray()) as Array<{ _id: unknown; name?: string }>;
  const nameById = new Map<string, string>();
  for (const t of typeDocs) {
    if (typeof t.name === "string") nameById.set(String(t._id), t.name);
  }
  console.log(`Loaded ${nameById.size} leave-type names.`);

  // Iterate leaves and update `type` where it diverges from the lookup.
  // Bulk-updating per name would be faster but the collection is small
  // and this keeps the script easy to reason about.
  const cursor = leaves.find(
    { leaveType: { $exists: true, $ne: null } },
    { projection: { _id: 1, leaveType: 1, type: 1 } },
  );

  let inspected = 0;
  let updated = 0;
  let skipped = 0;
  const bulk: Array<{
    updateOne: {
      filter: { _id: unknown };
      update: { $set: { type: string } };
    };
  }> = [];

  // Type guard: cursor returns unknown shapes; we narrow below.
  while (await cursor.hasNext()) {
    const doc = (await cursor.next()) as unknown as {
      _id: unknown;
      leaveType?: unknown;
      type?: string;
    };
    inspected++;
    const correctName = nameById.get(String(doc.leaveType));
    if (!correctName) {
      // Reference points at a type that no longer exists. Don't touch
      // — the operator should inspect manually.
      skipped++;
      continue;
    }
    if (doc.type === correctName) continue; // already correct
    bulk.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { type: correctName } },
      },
    });
    if (bulk.length >= 500) {
      const r = await leaves.bulkWrite(bulk);
      updated += r.modifiedCount || 0;
      bulk.length = 0;
    }
  }
  if (bulk.length) {
    const r = await leaves.bulkWrite(bulk);
    updated += r.modifiedCount || 0;
  }

  console.log(
    `\nDone. Inspected ${inspected}, updated ${updated}, skipped ${skipped} (orphaned ref).`,
  );

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error("Migration failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
