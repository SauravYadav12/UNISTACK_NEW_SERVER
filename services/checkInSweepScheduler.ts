/**
 * Check-in auto-checkout sweep.
 *
 * Every 30 minutes, closes any CheckInSession that has been open for
 * longer than the 14h cap. This is the safety net for the "employee
 * closed the browser / their machine crashed and never checked out"
 * case: the session is finalized at exactly checkInAt + 14h, flagged
 * `autoCheckout` + source `auto` so the super-admin log can distinguish
 * it from a real checkout.
 *
 * The `finalizeStaleForUser` path in the controller also closes stale
 * sessions on read, so the log is correct the moment anyone looks — this
 * sweep just guarantees the data converges even if nobody reads.
 *
 * Mirrors the self-scheduling setTimeout pattern used by the other
 * schedulers (probation, invoice-due, etc.).
 */

import {
  CheckInSessionModel,
  MAX_SESSION_MS,
} from "../models/checkInSessionModel";
import { AttendanceModel } from "../models/attendance";

const SWEEP_INTERVAL_MS = 30 * 60 * 1000; // every 30 minutes

let timer: NodeJS.Timeout | null = null;
let initialised = false;

async function runSweep(): Promise<void> {
  const cutoff = new Date(Date.now() - MAX_SESSION_MS);
  const stale = await CheckInSessionModel.find({
    checkOutAt: null,
    checkInAt: { $lte: cutoff },
  });
  if (!stale.length) return;

  for (const s of stale) {
    const closeAt = new Date(s.checkInAt.getTime() + MAX_SESSION_MS);
    s.checkOutAt = closeAt;
    s.autoCheckout = true;
    s.checkoutSource = "auto";
    s.durationSeconds = Math.round(MAX_SESSION_MS / 1000);
    await s.save();
    // Keep the attendance row's checkOut consistent (best-effort).
    try {
      await AttendanceModel.findOneAndUpdate(
        { userRef: s.userRef as never },
        { checkOut: closeAt },
        { sort: { createdAt: -1 } }
      );
    } catch {
      // non-fatal
    }
  }
  console.log(`[checkin-sweep] auto-closed ${stale.length} stale session(s).`);
}

function scheduleNext(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await runSweep();
    } catch (e) {
      console.error("[checkin-sweep] sweep failed:", e);
    } finally {
      scheduleNext();
    }
  }, SWEEP_INTERVAL_MS);
}

export function startCheckInSweepScheduler(): void {
  if (initialised) return;
  initialised = true;
  console.log("[checkin-sweep] starting");
  // Run once on boot to catch anything left open while the server was down.
  void runSweep().catch((e) =>
    console.error("[checkin-sweep] initial sweep failed:", e)
  );
  scheduleNext();
}
