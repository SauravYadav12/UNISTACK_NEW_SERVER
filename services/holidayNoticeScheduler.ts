import moment from "moment-timezone";
import { sendHolidayNoticesForToday } from "./holidayNoticeService";

// Run daily at 09:00 EST. Independent of any user being logged in; the
// server owns the cadence via a self-scheduling setTimeout loop (same
// pattern as leaveBalanceScheduler).
const TZ = "America/New_York";
const HOUR_OF_DAY = 9;

let timer: NodeJS.Timeout | null = null;

function msUntilNextTick(): number {
  const now = moment.tz(TZ);
  const next = moment
    .tz(TZ)
    .hour(HOUR_OF_DAY)
    .minute(0)
    .second(0)
    .millisecond(0);
  if (!next.isAfter(now)) next.add(1, "day");
  return next.valueOf() - Date.now();
}

async function tick() {
  try {
    const result = await sendHolidayNoticesForToday();
    if (result.holidays > 0) {
      console.log(
        `[holiday-notice] Sent ${result.emails} email(s) for ${result.holidays} holiday(s)`,
      );
    }
  } catch (e) {
    console.error("[holiday-notice] Tick failed:", (e as Error).message);
  } finally {
    scheduleNext();
  }
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  const wait = msUntilNextTick();
  timer = setTimeout(tick, wait);
  const nextAt = moment.tz(TZ).add(wait, "ms").format("LLLL");
  console.log(`[holiday-notice] Next check scheduled for ${nextAt} ${TZ}`);
}

export function initHolidayNoticeScheduler() {
  // Fire once on startup so a freshly-deployed server catches up on any
  // holidays whose notice window hit today, then schedule the daily cadence.
  // Using a small delay so the rest of the server finishes booting first.
  setTimeout(() => {
    tick().catch((e) =>
      console.error("[holiday-notice] Startup tick failed:", e),
    );
  }, 5000);
}
