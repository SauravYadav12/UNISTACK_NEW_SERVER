/**
 * Presence → auto-lock sweep.
 *
 * Every 30 seconds: any employee whose PresenceState.awaySince is older
 * than BREAK_AUTO_LOCK_MINUTES (default 5), inside office hours, gets a
 * presence-sourced BreakSession — which locks their Unistack until an admin
 * clears it. `awaySince` older than STALE_AWAY_MS is discarded instead (the
 * camera missed the return, or it's yesterday's exit).
 *
 * The sweep NEVER closes breaks. Same self-scheduling setTimeout pattern as
 * checkInSweepScheduler.
 */

import { PresenceStateModel } from "../models/presenceStateModel";
import { autoLockMinutes, autoStartPresenceBreak } from "./breakService";
import { isWithinOfficeHours } from "../utils/officeTime";

export const BREAK_SWEEP_INTERVAL_MS = 30 * 1000;
/** A `left` with no lock for this long is treated as a missed `returned`. */
export const STALE_AWAY_MS = 2 * 60 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;
let initialised = false;

export interface SweepResult {
  locked: number;
  discarded: number;
  skippedOutsideOfficeHours: boolean;
}

export async function runBreakSweepTick(now: Date = new Date()): Promise<SweepResult> {
  const result: SweepResult = { locked: 0, discarded: 0, skippedOutsideOfficeHours: false };

  // Drop stale away markers regardless of office hours.
  const staleCutoff = new Date(now.getTime() - STALE_AWAY_MS);
  const stale = await PresenceStateModel.updateMany(
    { awaySince: { $ne: null, $lte: staleCutoff } },
    { $set: { awaySince: null } },
  );
  result.discarded = (stale as { nModified?: number }).nModified ?? 0;

  if (!isWithinOfficeHours(now)) {
    result.skippedOutsideOfficeHours = true;
    return result;
  }

  const cutoff = new Date(now.getTime() - autoLockMinutes() * 60 * 1000);
  const due = await PresenceStateModel.find({
    awaySince: { $ne: null, $lte: cutoff },
  });
  for (const state of due) {
    const doc = await autoStartPresenceBreak(state.userRef, state.lastCameraId);
    if (doc) result.locked += 1;
  }
  if (result.locked) {
    console.log(`[break-sweep] auto-locked ${result.locked} employee(s).`);
  }
  return result;
}

function scheduleNext(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await runBreakSweepTick();
    } catch (e) {
      console.error("[break-sweep] tick failed:", e);
    } finally {
      scheduleNext();
    }
  }, BREAK_SWEEP_INTERVAL_MS);
}

export function startBreakSweepScheduler(): void {
  if (initialised) return;
  initialised = true;
  console.log("[break-sweep] starting");
  void runBreakSweepTick().catch((e) =>
    console.error("[break-sweep] initial tick failed:", e),
  );
  scheduleNext();
}
