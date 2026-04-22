import moment from "moment-timezone";
import { InvoiceModel } from "../models/invoiceModel";
import { ProjectModel } from "../models/projectModel";
import { sendInvoiceDueEmail } from "./invoiceEmailService";
import ENV_VARS from "../config/env.config";

// Run daily at 09:00 IST (configurable via INVOICE_DUE_CHECK_HOUR).
// Same self-scheduling pattern as holidayNoticeScheduler.
const TZ = "Asia/Kolkata";

function hourOfDay(): number {
  const h = Number(ENV_VARS.INVOICE_DUE_CHECK_HOUR);
  return Number.isFinite(h) && h >= 0 && h <= 23 ? h : 9;
}

let timer: NodeJS.Timeout | null = null;

function msUntilNextTick(): number {
  const now = moment.tz(TZ);
  const next = moment.tz(TZ).hour(hourOfDay()).minute(0).second(0).millisecond(0);
  if (!next.isAfter(now)) next.add(1, "day");
  return next.valueOf() - Date.now();
}

/**
 * Find Raised invoices whose dueDate is in the past and haven't been alerted
 * yet. Flip to Due, stamp dueNotifiedAt, email accounts team. Idempotent —
 * re-running doesn't re-alert thanks to the dueNotifiedAt gate.
 */
export async function runInvoiceDueTick(): Promise<{ flipped: number; alerted: number }> {
  const today = moment.tz(TZ).format("YYYY-MM-DD");
  const candidates = await InvoiceModel.find({
    status: "Raised",
    dueDate: { $lt: today },
    $or: [{ dueNotifiedAt: { $exists: false } }, { dueNotifiedAt: null as unknown as Date }],
  });

  let alerted = 0;
  for (const inv of candidates) {
    inv.status = "Due";
    inv.dueNotifiedAt = new Date();
    try {
      await inv.save();
    } catch (e) {
      console.warn("[invoice-due] save failed:", (e as Error).message);
      continue;
    }
    try {
      const project = await ProjectModel.findById(inv.projectRef);
      if (project) {
        await sendInvoiceDueEmail({ invoice: inv, project });
        alerted += 1;
      }
    } catch (e) {
      console.warn(
        `[invoice-due] alert email failed for ${inv.invoiceNumber}:`,
        (e as Error).message
      );
    }
  }

  return { flipped: candidates.length, alerted };
}

async function tick() {
  try {
    const result = await runInvoiceDueTick();
    if (result.flipped > 0) {
      console.log(
        `[invoice-due] Flipped ${result.flipped} invoice(s) to Due, alerted ${result.alerted}`
      );
    }
  } catch (e) {
    console.error("[invoice-due] Tick failed:", (e as Error).message);
  } finally {
    scheduleNext();
  }
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  const wait = msUntilNextTick();
  timer = setTimeout(tick, wait);
  const nextAt = moment.tz(TZ).add(wait, "ms").format("LLLL");
  console.log(`[invoice-due] Next check scheduled for ${nextAt} ${TZ}`);
}

export function initInvoiceDueScheduler() {
  setTimeout(() => {
    tick().catch((e) =>
      console.error("[invoice-due] Startup tick failed:", e)
    );
  }, 5000);
}
