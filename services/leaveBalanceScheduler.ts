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

// Company policy bumped from 10 → 12 yearly for both PL and ML, with
// ML now also accruing 1/mo (previously uncapped). This migration:
//   - bumps the LeaveType defaults from 10 → 12 (only if still on the
//     old default, so admin customizations like "15" stay intact)
//   - sets ML.monthlyQuota = 1 (only if still null, ditto)
//   - bumps any LeaveBalance row whose `allocated` is still exactly 10
//     (= the old default) up to 12, so existing employees see 12/12
//     without waiting for HR to click Force Reset
// All conditions are exact-match against the old default, so an admin
// who set a per-user override to 8 or 15 keeps it. Safe to re-run.
async function migrateLeaveTypeYearlyTo12() {
  type AnyUpdateResult = {
    modifiedCount?: number;
    nModified?: number;
    n?: number;
  };
  function modified(r: unknown): number {
    const x = r as AnyUpdateResult | undefined;
    return x?.modifiedCount ?? x?.nModified ?? 0;
  }

  // 1. LeaveType row policy bump — only when the existing value matches
  //    the OLD default exactly. Anything else means an admin touched it.
  const typeBump = await LeaveTypeModel.updateMany(
    { code: { $in: ["PL", "ML"] }, defaultAllocationPerYear: 10 },
    { $set: { defaultAllocationPerYear: 12 } },
  );
  const typeBumped = modified(typeBump);
  if (typeBumped) {
    console.log(
      `[leave-balance] Bumped ${typeBumped} LeaveType row(s) from 10 → 12 yearly`,
    );
  }
  // Also set ML monthly accrual to 1/mo when still null (= old policy).
  const mlQuotaBump = await LeaveTypeModel.updateMany(
    { code: "ML", monthlyQuota: null },
    { $set: { monthlyQuota: 1 } },
  );
  const mlBumped = modified(mlQuotaBump);
  if (mlBumped) {
    console.log(
      `[leave-balance] Set ML.monthlyQuota = 1 on ${mlBumped} LeaveType row(s)`,
    );
  }

  // 2. Bump existing employee balances still on the old 10-day cap.
  //    Looked up by leaveType ref to avoid hard-coding ObjectIds.
  const targetTypes = await LeaveTypeModel.find(
    { code: { $in: ["PL", "ML"] } },
    { _id: 1, code: 1 },
  ).lean();
  if (targetTypes.length === 0) return;
  const typeIds = targetTypes.map((t) => t._id);
  const balanceBump = await LeaveBalanceModel.updateMany(
    { leaveType: { $in: typeIds }, allocated: 10 },
    { $set: { allocated: 12 } },
  );
  const balancesBumped = modified(balanceBump);
  if (balancesBumped) {
    console.log(
      `[leave-balance] Bumped ${balancesBumped} employee LeaveBalance row(s) from 10 → 12 allocated`,
    );
  }
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

    // Bump 10/yr → 12/yr for PL + ML rows still on the old default,
    // plus their per-user balances. Idempotent + override-preserving.
    await migrateLeaveTypeYearlyTo12();

    const currentYear = moment.tz(TZ).year();
    const result = await resetBalancesForYear(currentYear, { force: false });
    console.log(`[leave-balance] Bootstrapped ${currentYear} balances:`, result);

    scheduleNext();
  } catch (e) {
    console.error("[leave-balance] Init failed:", e);
  }
}
