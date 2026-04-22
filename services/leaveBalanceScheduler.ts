import moment from "moment-timezone";
import { resetBalancesForYear } from "./leaveBalanceService";
import { seedDefaultLeaveTypes, LeaveTypeModel } from "../models/leaveTypeModel";
import { LeaveBalanceModel } from "../models/leaveBalanceModel";

const TZ = "Asia/Kolkata"; // IST — Jan 1 midnight Indian standard time.

function msUntilNextNewYear(): number {
  const now = moment.tz(TZ);
  const nextNewYear = moment.tz(
    { year: now.year() + 1, month: 0, day: 1, hour: 0, minute: 0, second: 0 },
    TZ,
  );
  return nextNewYear.valueOf() - Date.now();
}

async function runYearlyReset(year: number) {
  try {
    console.log(`[leave-balance] Running yearly reset for ${year} (IST)`);
    const result = await resetBalancesForYear(year, { force: true });
    console.log("[leave-balance] Reset complete:", result);
  } catch (e) {
    console.error("[leave-balance] Reset failed:", e);
  }
}

let scheduledTimer: NodeJS.Timeout | null = null;

function scheduleNext() {
  if (scheduledTimer) clearTimeout(scheduledTimer);
  const ms = msUntilNextNewYear();
  // setTimeout's max is ~24.8 days on 32-bit systems; Node handles larger
  // values. If ms is huge we chunk to be safe.
  const MAX = 2_147_483_647;
  const wait = Math.min(ms, MAX);
  scheduledTimer = setTimeout(
    async () => {
      if (ms > MAX) {
        scheduleNext(); // tail-end re-schedule to cover residual time
        return;
      }
      const year = moment.tz(TZ).year(); // year at fire time (just turned over)
      await runYearlyReset(year);
      scheduleNext();
    },
    wait,
  );
  const fireAt = moment.tz(TZ).add(ms, "milliseconds").format("LLLL z");
  console.log(`[leave-balance] Next yearly reset scheduled for ${fireAt}`);
}

// One-time migration: the previous schema for LeaveBalance was keyed by
// `{user, year}` with bonusPaid/bonusMedical fields, so Mongo has a stale
// unique index `user_1_year_1` that blocks the new per-type rows. We also
// drop any legacy documents that predate the `leaveType` field.
async function migrateLegacyLeaveBalances() {
  const coll = LeaveBalanceModel.collection;

  // 1) Delete old-shape docs so they don't collide with the new unique index
  //    once it's built. Identified by missing leaveType OR having bonus fields.
  const del = await coll.deleteMany({
    $or: [
      { leaveType: { $exists: false } },
      { bonusPaid: { $exists: true } },
      { bonusMedical: { $exists: true } },
    ],
  });
  if (del.deletedCount) {
    console.log(`[leave-balance] Dropped ${del.deletedCount} legacy balance doc(s)`);
  }

  // 2) Drop the stale index from the old schema if present.
  try {
    type IndexInfo = { name?: string; key?: Record<string, number> };
    const indexes = (await coll.indexes()) as IndexInfo[];
    const stale = indexes.find(
      (i: IndexInfo) =>
        i.name === "user_1_year_1" ||
        (!!i.key &&
          Object.keys(i.key).length === 2 &&
          i.key.user === 1 &&
          i.key.year === 1 &&
          !i.key.leaveType),
    );
    if (stale && stale.name) {
      await coll.dropIndex(stale.name);
      console.log(`[leave-balance] Dropped stale index ${stale.name}`);
    }
  } catch (e) {
    // dropIndex throws if the index doesn't exist on a fresh DB — safe to ignore.
    const msg = (e as { message?: string })?.message || "";
    if (!/index not found/i.test(msg)) {
      console.warn("[leave-balance] Index cleanup warning:", msg);
    }
  }

  // 3) Make sure the new compound index is built before we try bulk upserts.
  await LeaveBalanceModel.syncIndexes();
}

// Existing LeaveType rows predating the `monthlyQuota` field show up with
// the field missing, which makes `computeMonthlyAvailable` treat them as
// uncapped (returning annualRemaining instead of the 1.5/month cap). Backfill
// a sensible default for capped types so the feature works without HR having
// to manually save each row.
async function migrateLeaveTypeMonthlyQuotas() {
  // Older mongoose returns `{ n, nModified }`; newer returns `modifiedCount`.
  // Read whichever is present so this compiles on either version.
  type AnyUpdateResult = {
    modifiedCount?: number;
    nModified?: number;
    n?: number;
  };
  function modified(r: unknown): number {
    const x = r as AnyUpdateResult | undefined;
    return x?.modifiedCount ?? x?.nModified ?? 0;
  }

  // Only touch rows where `monthlyQuota` was never set. If someone explicitly
  // stored null (meaning "no monthly cap" — like ML), leave it alone.
  // ML is identified by code to match the seed defaults.
  const capped = await LeaveTypeModel.updateMany(
    {
      monthlyQuota: { $exists: false },
      isUnpaidBucket: { $ne: true },
      code: { $ne: "ML" },
    },
    { $set: { monthlyQuota: 1.5 } },
  );
  const cappedCount = modified(capped);
  if (cappedCount) {
    console.log(
      `[leave-balance] Backfilled monthlyQuota=1.5 on ${cappedCount} LeaveType row(s)`,
    );
  }
  // Make ML / UL explicit so they survive round-trips through the admin UI.
  await LeaveTypeModel.updateMany(
    { monthlyQuota: { $exists: false }, code: { $in: ["ML", "UL"] } },
    { $set: { monthlyQuota: null } },
  );
}

// Initial bootstrap: seed default leave types if none exist, and seed
// balances for the current year (no force — won't overwrite existing allocations).
export async function initLeaveBalanceSystem() {
  try {
    await migrateLegacyLeaveBalances();

    const seeded = await seedDefaultLeaveTypes();
    if (seeded) console.log(`[leave-balance] Seeded ${seeded} default leave types`);

    // Always run after seed — safe because it no-ops on fresh DBs where the
    // newly-seeded rows already have monthlyQuota set.
    await migrateLeaveTypeMonthlyQuotas();

    const currentYear = moment.tz(TZ).year();
    const result = await resetBalancesForYear(currentYear, { force: false });
    console.log(`[leave-balance] Bootstrapped ${currentYear} balances:`, result);

    scheduleNext();
  } catch (e) {
    console.error("[leave-balance] Init failed:", e);
  }
}
