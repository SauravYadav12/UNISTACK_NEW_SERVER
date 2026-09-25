import moment from "moment-timezone";
import ENV_VARS from "../config/env.config";

/**
 * Office-hours + timezone helpers for the break-discipline module.
 *
 * The company runs a US-hours office (09:00–18:00 America/New_York) with a
 * team physically in India. Every timestamp is stored in UTC; these helpers
 * decide (a) which OFFICE day an instant belongs to and (b) whether an
 * instant is inside working hours. Using the IANA zone means EST/EDT is
 * handled automatically — never hardcode a fixed offset here.
 */

export const OFFICE_TZ: string = ENV_VARS.OFFICE_TZ || "America/New_York";
export const IST_TZ = "Asia/Kolkata";

function parseHHmm(value: string | undefined, fallback: string): [number, number] {
  const raw = (value || fallback).trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!m) {
    const f = /^(\d{1,2}):(\d{2})$/.exec(fallback) as RegExpExecArray;
    return [Number(f[1]), Number(f[2])];
  }
  return [Number(m[1]), Number(m[2])];
}

export const OFFICE_START_HHMM = parseHHmm(ENV_VARS.OFFICE_START, "09:00");
export const OFFICE_END_HHMM = parseHHmm(ENV_VARS.OFFICE_END, "18:00");

export function officeMoment(at: Date = new Date()): moment.Moment {
  return moment.tz(at, OFFICE_TZ);
}

/** `YYYY-MM-DD` of the office day this instant falls on. */
export function officeDate(at: Date = new Date()): string {
  return officeMoment(at).format("YYYY-MM-DD");
}

/** Mon–Fri and between OFFICE_START and OFFICE_END in the office zone. */
export function isWithinOfficeHours(at: Date = new Date()): boolean {
  const m = officeMoment(at);
  const dow = m.day();
  if (dow === 0 || dow === 6) return false;
  const minutes = m.hours() * 60 + m.minutes();
  const start = OFFICE_START_HHMM[0] * 60 + OFFICE_START_HHMM[1];
  const end = OFFICE_END_HHMM[0] * 60 + OFFICE_END_HHMM[1];
  return minutes >= start && minutes < end;
}

export type RangeScope = "day" | "week" | "month";

/**
 * Inclusive `YYYY-MM-DD` bounds for a day/week/month window anchored on an
 * office date. Matches the string-compare convention used by the check-in
 * logs (lexicographic on YYYY-MM-DD is safe).
 */
export function officeDayRange(
  scope: RangeScope,
  anchorStr?: string,
): { from: string; to: string } {
  const anchor = anchorStr
    ? moment.tz(anchorStr, "YYYY-MM-DD", OFFICE_TZ)
    : moment.tz(OFFICE_TZ);
  let from = anchor.clone().startOf("day");
  let to = anchor.clone().endOf("day");
  if (scope === "week") {
    from = anchor.clone().startOf("isoWeek");
    to = anchor.clone().endOf("isoWeek");
  } else if (scope === "month") {
    from = anchor.clone().startOf("month");
    to = anchor.clone().endOf("month");
  }
  return { from: from.format("YYYY-MM-DD"), to: to.format("YYYY-MM-DD") };
}

export function normaliseScope(raw: unknown): RangeScope {
  const s = String(raw || "day").toLowerCase();
  return s === "week" || s === "month" ? s : "day";
}

/** Human string for the office-hours banner, e.g. "9:00 AM–6:00 PM EST". */
export function officeHoursLabel(at: Date = new Date()): string {
  const m = officeMoment(at);
  const start = m.clone().hours(OFFICE_START_HHMM[0]).minutes(OFFICE_START_HHMM[1]);
  const end = m.clone().hours(OFFICE_END_HHMM[0]).minutes(OFFICE_END_HHMM[1]);
  return `${start.format("h:mm A")}–${end.format("h:mm A z")}`;
}
