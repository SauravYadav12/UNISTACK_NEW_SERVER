/**
 * Employee Pulse — per-employee aggregator.
 *
 * Single-endpoint aggregator that returns a bundle sized for the Employee
 * Pulse page:
 *
 *   { users, kpis, metricsGrid, trend, proactivity }
 *
 * Four surfaces:
 *   • KPI ribbon per user (customisable stats picker on the client)
 *   • Metrics compare table (when 2+ users)
 *   • Position / Tech trend chart
 *   • Proactivity Board — for parent reqs entered in the window, ranks
 *     marketers by their first-action time (child req creation is the
 *     primary signal; first entry in mComment[] is the secondary signal,
 *     name-matched against the user roster).
 *
 * All in one file (~700 lines) — split would force duplicated fetches
 * across sub-services since the trend + KPI + proactivity all read from
 * the same requirement + interview sets.
 */
import { FilterQuery, Types } from "mongoose";
import moment from "moment";

import { RequirementModel } from "../models/requirementModel";
import { InterviewModel } from "../models/interviewModel";
import { UserModel } from "../models/userModel";

import {
  computeMarketingMetrics,
  computeSupportMetrics,
  scoreMarketing,
  scoreSupport,
  isScoredInterview,
  ReqForScoring,
  InterviewForScoring,
} from "../utils/scoring";
import {
  DEFAULT_MARKETING_WEIGHTS,
  DEFAULT_SUPPORT_WEIGHTS,
  PerformanceWeightsModel,
} from "../models/performanceWeightsModel";
import { UserRole } from "../enums/UserEnum";
import {
  resolveTitles,
  type CanonicalGroupType,
} from "./titleCanonicalService";

// ─── Public types ───────────────────────────────────────────────────

export type PulseGroupBy =
  | "jobTitle"
  | "primaryTech"
  | "secondaryTech"
  | "primaryTechStack"
  | "clientCompany"
  | "employementType"
  | "taxType"
  | "remote";

export type PulseBucket = "day" | "week" | "biweek" | "month";
export type PulseMetric =
  | "positions"
  | "submissions"
  | "interviewsCompleted"
  | "offers"
  | "score";

/**
 * Requirement-form filter set. Values missing / empty-string are ignored.
 * Text fields become case-insensitive contains matches; enum fields become
 * `$in` filters; date fields become range filters on `createdAt` (we use
 * the req's createdAt as the "when this req entered the pipeline" anchor).
 */
export interface PulseReqFilter {
  reqStatus?: string | string[];
  assignedToRef?: string;
  reqEnteredByRef?: string;
  appliedForRef?: string;
  recordOwner?: string;
  starColor?: string | string[];
  isDuplicate?: string;
  jobTitle?: string;
  employementType?: string | string[];
  primaryTech?: string;
  secondaryTech?: string;
  primaryTechStack?: string;
  gotOnResume?: string;
  rateMin?: number;
  rateMax?: number;
  taxType?: string | string[];
  remote?: string | string[];
  duration?: string | string[];
  clientCompany?: string;
  clientPerson?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientWebsite?: string;
  clientAddress?: string;
  primeVendorCompany?: string;
  primeVendorName?: string;
  primeVendorEmail?: string;
  primeVendorPhone?: string;
  primeVendorWebsite?: string;
  vendorCompany?: string;
  vendorPersonName?: string;
  vendorEmail?: string;
  vendorPhone?: string;
  vendorWebsite?: string;
  gotReqFrom?: string;
  jobPortalLink?: string;
  parentReqID?: string;
  childSuffix?: string;
  reqEnteredFrom?: string; // YYYY-MM-DD
  reqEnteredTo?: string;
}

export interface PulseInput {
  userIds: string[]; // max 4; may be empty (trend chart still works)
  from: Date;
  to: Date;
  reqFilter?: PulseReqFilter;
  groupBy?: PulseGroupBy;
  bucket?: PulseBucket;
  metric?: PulseMetric;
}

export interface PulseUser {
  userId: string;
  name: string;
  email: string;
  role: string[];
}

export interface PulseKpi {
  userId: string;
  role: "marketing" | "support" | "mixed";
  score: number;
  // Event counts within the range — retained because Trend + Compare
  // Table + Sparkline read from them.
  submissions: number;
  interviewsConfirmed: number;
  interviewsCompleted: number;
  offers: number;
  // Snapshot counts of requirements the user owns (assigned OR entered),
  // bucketed by current reqStatus. Enables the card to show "how many
  // reqs are currently in each stage" — separate from the event counts
  // above which capture flow within the range.
  statusCounts: Record<string, number>;
  activeDayStreak: number;
  sparkline: number[]; // last 7 buckets of event counts
}

export interface PulseTrendSeries {
  name: string;
  data: number[];
}

export interface PulseTrend {
  groupBy: PulseGroupBy;
  bucket: PulseBucket;
  metric: PulseMetric;
  xAxis: string[];
  series: PulseTrendSeries[];
  truncated: boolean;
  totalSeries: number;
}

// ─── Proactivity Board types ───────────────────────────────────────

export interface PulseProactivityActor {
  userId: string;
  name: string;
  firstActionAt: string; // ISO
  /**
   * Kind of the winning first action. Always "comment" for now — the
   * rule is: first comment on any child of the parent req wins. Kept as
   * a union to leave room for future action kinds without a client
   * breaking-change.
   */
  firstActionKind: "comment";
  /** reqID of the child req the comment was placed on. */
  childReqID?: string;
  msFromEntry: number;
}

export interface PulseProactivityReq {
  parentReqID: string;
  jobTitle: string;
  clientCompany: string;
  enteredAt: string; // ISO
  enteredBy: { userId?: string; name: string };
  actors: PulseProactivityActor[];
}

export interface PulseProactivityLeader {
  userId: string;
  name: string;
  firstPlaceCount: number;
  secondPlaceCount: number;
  thirdOrLaterCount: number;
  totalActedOn: number;
  medianMsToAct: number | null;
}

export interface PulseProactivity {
  window: { from: string; to: string };
  totals: {
    positionsEntered: number;
    childrenCreated: number;
    unclaimedParents: number;
  };
  reqs: PulseProactivityReq[];
  leaderboard: PulseProactivityLeader[];
}

export interface PulseBundle {
  users: PulseUser[];
  kpis: PulseKpi[];
  metricsGrid: Record<string, Record<string, number>>;
  trend: PulseTrend;
  proactivity: PulseProactivity;
}

/**
 * Row shape returned by the KPI status drilldown. `relevantTimestamp`
 * is the timestamp field that qualified this req into the requested
 * status window (e.g. _perfSubmittedAt for "Submitted", createdAt for
 * "New Working", updatedAt for the non-perf statuses).
 */
export interface PulseStatusDrilldownReq {
  reqID: string;
  reqStatus: string;
  jobTitle: string;
  clientCompany: string;
  primaryTech?: string;
  createdAt: string;
  updatedAt: string;
  relevantAt: string;
  relevantField:
    | "createdAt"
    | "updatedAt"
    | "_perfInProgressAt"
    | "_perfSubmittedAt"
    | "_perfInterviewedAt"
    | "_perfProjectActiveAt"
    | "_perfProjectInactiveAt";
}

// ─── Helpers ─────────────────────────────────────────────────────────

const TREND_TOP_N = 8;
const SPARKLINE_BUCKETS = 7;
const PROACTIVITY_REQ_CAP = 100;

function normalizeUserIds(ids: string[]): Types.ObjectId[] {
  return ids
    .filter((s) => typeof s === "string" && Types.ObjectId.isValid(s))
    .map((s) => new Types.ObjectId(s));
}

function dayKey(d: Date | string | undefined): string {
  if (!d) return "";
  return moment(d).format("YYYY-MM-DD");
}

function bucketStart(d: Date | string, bucket: PulseBucket): string {
  const m = moment(d);
  if (bucket === "day") return m.format("YYYY-MM-DD");
  if (bucket === "week") return m.startOf("isoWeek").format("YYYY-MM-DD");
  if (bucket === "month") return m.startOf("month").format("YYYY-MM-DD");
  // biweek — pin to the isoWeek start, then floor to the closest even week
  // relative to the first week of the year so buckets stay stable.
  const wow = m.clone().startOf("isoWeek");
  const isoWeek = wow.isoWeek();
  if (isoWeek % 2 === 0) wow.subtract(1, "week");
  return wow.format("YYYY-MM-DD");
}

function buildBucketList(from: Date, to: Date, bucket: PulseBucket): string[] {
  const out: string[] = [];
  const cursor = moment(bucketStart(from, bucket));
  const stop = moment(to);
  while (cursor.isSameOrBefore(stop)) {
    // Daily buckets exclude weekends — Saturdays and Sundays waste
    // chart real estate for an org that doesn't operate on those days.
    // Weekly / bi-weekly / monthly buckets naturally absorb weekends,
    // so the filter only applies to `day`.
    if (bucket !== "day" || !isWeekend(cursor)) {
      out.push(cursor.format("YYYY-MM-DD"));
    }
    if (bucket === "day") cursor.add(1, "day");
    else if (bucket === "week") cursor.add(1, "week");
    else if (bucket === "biweek") cursor.add(2, "week");
    else cursor.add(1, "month");
  }
  return out;
}

function isWeekend(m: moment.Moment): boolean {
  const dow = m.isoWeekday(); // 1=Mon..7=Sun
  return dow === 6 || dow === 7;
}

function displayName(u: {
  firstName?: string;
  lastName?: string;
  email: string;
}): string {
  const n = `${u.firstName || ""} ${u.lastName || ""}`.trim();
  return n || u.email;
}

function primaryRole(roles: string[]): "marketing" | "support" | "mixed" {
  const hasMkt = roles.includes(UserRole.Marketing);
  const hasSup = roles.includes(UserRole.Support);
  if (hasMkt && !hasSup) return "marketing";
  if (hasSup && !hasMkt) return "support";
  return "mixed";
}

function buildReqFilterQuery(
  f?: PulseReqFilter,
): FilterQuery<Record<string, unknown>> {
  const q: Record<string, unknown> = {};
  if (!f) return q;

  const put = (key: string, value: unknown, opts?: { contains?: boolean }) => {
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value) && value.length === 0) return;
    if (Array.isArray(value)) {
      q[key] = { $in: value };
    } else if (opts?.contains && typeof value === "string") {
      q[key] = { $regex: value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    } else {
      q[key] = value;
    }
  };

  put("reqStatus", f.reqStatus);
  put("assignedToRef", f.assignedToRef);
  put("reqEnteredByRef", f.reqEnteredByRef);
  put("appliedForRef", f.appliedForRef);
  put("recordOwner", f.recordOwner, { contains: true });
  put("starColor", f.starColor);
  put("isDuplicate", f.isDuplicate);
  put("jobTitle", f.jobTitle, { contains: true });
  put("employementType", f.employementType);
  put("primaryTech", f.primaryTech, { contains: true });
  put("secondaryTech", f.secondaryTech, { contains: true });
  put("primaryTechStack", f.primaryTechStack, { contains: true });
  put("gotOnResume", f.gotOnResume, { contains: true });
  put("clientCompany", f.clientCompany, { contains: true });
  put("clientPerson", f.clientPerson, { contains: true });
  put("clientEmail", f.clientEmail, { contains: true });
  put("clientPhone", f.clientPhone, { contains: true });
  put("clientWebsite", f.clientWebsite, { contains: true });
  put("clientAddress", f.clientAddress, { contains: true });
  put("primeVendorCompany", f.primeVendorCompany, { contains: true });
  put("primeVendorName", f.primeVendorName, { contains: true });
  put("primeVendorEmail", f.primeVendorEmail, { contains: true });
  put("primeVendorPhone", f.primeVendorPhone, { contains: true });
  put("primeVendorWebsite", f.primeVendorWebsite, { contains: true });
  put("vendorCompany", f.vendorCompany, { contains: true });
  put("vendorPersonName", f.vendorPersonName, { contains: true });
  put("vendorEmail", f.vendorEmail, { contains: true });
  put("vendorPhone", f.vendorPhone, { contains: true });
  put("vendorWebsite", f.vendorWebsite, { contains: true });
  put("gotReqFrom", f.gotReqFrom, { contains: true });
  put("jobPortalLink", f.jobPortalLink, { contains: true });
  put("parentReqID", f.parentReqID);
  put("childSuffix", f.childSuffix);

  // Nested arrays (taxType / remote / duration) use $elemMatch on the value
  // field. The requirement schema stores them as `[Array]` so entries look
  // like `[{ value: 'W2', ...}]` — but our historical inserts also allow
  // bare strings. Match either.
  const arrayLikeFilter = (val: string | string[] | undefined) => {
    if (!val) return undefined;
    const arr = Array.isArray(val) ? val : [val];
    if (arr.length === 0) return undefined;
    return { $in: arr };
  };
  const tt = arrayLikeFilter(f.taxType);
  const rm = arrayLikeFilter(f.remote);
  const du = arrayLikeFilter(f.duration);
  if (tt) q["taxType"] = { $elemMatch: tt };
  if (rm) q["remote"] = { $elemMatch: rm };
  if (du) q["duration"] = { $elemMatch: du };

  if (typeof f.rateMin === "number" || typeof f.rateMax === "number") {
    const inner: Record<string, number> = {};
    if (typeof f.rateMin === "number") inner.$gte = f.rateMin;
    if (typeof f.rateMax === "number") inner.$lte = f.rateMax;
    q["rate"] = { $elemMatch: { amount: inner } };
  }

  if (f.reqEnteredFrom || f.reqEnteredTo) {
    const inner: Record<string, string> = {};
    if (f.reqEnteredFrom) inner.$gte = f.reqEnteredFrom;
    if (f.reqEnteredTo) inner.$lte = f.reqEnteredTo;
    q["reqEnteredDate"] = inner;
  }

  return q;
}

// ─── The aggregator ─────────────────────────────────────────────────

export async function buildEmployeePulseBundle(
  input: PulseInput,
): Promise<PulseBundle> {
  const { from, to } = input;
  const userIds = normalizeUserIds(input.userIds).slice(0, 4);
  const reqFilter = buildReqFilterQuery(input.reqFilter);
  const groupBy: PulseGroupBy = input.groupBy || "jobTitle";
  const bucket: PulseBucket = input.bucket || "day";
  const metric: PulseMetric = input.metric || "positions";

  // ── Users lookup ──
  const userDocs = userIds.length
    ? await UserModel.find({ _id: { $in: userIds } })
        .select("firstName lastName email role")
        .lean()
    : [];
  const users: PulseUser[] = userDocs.map((u) => ({
    userId: String(u._id),
    name: displayName(u),
    email: u.email,
    role: u.role || [],
  }));

  // ── Weights (marketing + support share the source of truth with
  //    the leaderboard page). ──
  const [wMarketDoc, wSupportDoc] = await Promise.all([
    PerformanceWeightsModel.findOne({ role: "marketing" }).lean(),
    PerformanceWeightsModel.findOne({ role: "support" }).lean(),
  ]);
  const weightsMkt = wMarketDoc?.weights || DEFAULT_MARKETING_WEIGHTS;
  const weightsSup = wSupportDoc?.weights || DEFAULT_SUPPORT_WEIGHTS;

  // ── The "requirements in play" query.
  // Applied requirement filter is combined with:
  //   - assigned to any of these users OR entered by any of these users
  //   - the date-window filter is intentionally NOT applied here — scoring
  //     reads `_perf*At` timestamps and needs cross-window docs to correctly
  //     count events that span the window boundary.
  const userScoped = userIds.length
    ? {
        $or: [
          { assignedToRef: { $in: userIds } },
          { reqEnteredByRef: { $in: userIds } },
        ],
      }
    : {};
  const reqQuery: FilterQuery<Record<string, unknown>> = {
    ...reqFilter,
    ...userScoped,
  };

  const reqSelect =
    "reqID reqStatus assignedToRef reqEnteredByRef parentReqID childSuffix isDuplicate jobTitle primaryTech secondaryTech primaryTechStack clientCompany employementType taxType remote starColor createdAt updatedAt _perfInProgressAt _perfSubmittedAt _perfInterviewedAt _perfProjectActiveAt _perfProjectInactiveAt _perfStaleSubmissionFiredAt _perfUnworkedPenaltyFiredAt _perfUnprogressedPenaltyFiredAt";

  const [reqs, allInterviews, filteredReqIdsForTrend] = await Promise.all([
    RequirementModel.find(reqQuery).select(reqSelect).lean(),
    // Interviews are keyed to a req by `reqID` (string). Fetch all
    // interviews owned by these users, then intersect with the filtered
    // req set to respect the req filter.
    userIds.length
      ? InterviewModel.find({ marketingPersonRef: { $in: userIds } })
          .select(
            "intId reqID interviewStatus interviewWith interviewDate marketingPersonRef createdAt _perfConfirmedAt _perfCompletedAt _perfOfferAt _perfStaleConfirmFiredAt",
          )
          .lean()
      : Promise.resolve([]),
    // Trend query — respects the requirement filter, no user scoping,
    // AND window-scoped by "any activity in [from, to]". We only bucket
    // reqs whose relevant timestamp falls in the window; loading
    // outside-window reqs would be pure waste, especially at Today
    // range on a multi-year collection.
    RequirementModel.find({
      $and: [
        reqFilter,
        {
          $or: [
            { createdAt: { $gte: from, $lte: to } },
            { updatedAt: { $gte: from, $lte: to } },
            { _perfSubmittedAt: { $gte: from, $lte: to } },
            { _perfInterviewedAt: { $gte: from, $lte: to } },
            { _perfProjectActiveAt: { $gte: from, $lte: to } },
            { _perfProjectInactiveAt: { $gte: from, $lte: to } },
          ],
        },
      ],
    } as FilterQuery<Record<string, unknown>>)
      .select(
        "reqID jobTitle primaryTech secondaryTech primaryTechStack clientCompany employementType taxType remote assignedToRef createdAt updatedAt _perfSubmittedAt _perfInterviewedAt _perfProjectActiveAt _perfProjectInactiveAt",
      )
      .lean(),
  ]);

  // Reduce interviews to those whose reqID appears in the user-scoped req
  // set (so the req filter propagates to interview counts too).
  const reqIdSet = new Set(
    reqs.map((r) => (r as { reqID?: string }).reqID).filter(Boolean) as string[],
  );
  const interviews = allInterviews.filter(
    (iv) =>
      !(iv as { reqID?: string }).reqID ||
      reqIdSet.has((iv as { reqID?: string }).reqID as string),
  );

  // ── KPIs per user (reuse scoring util so numbers match Leaderboard). ──
  const kpis: PulseKpi[] = users.map((u) => {
    const uid = u.userId;
    const userReqs = (reqs as unknown as ReqForScoring[]).filter(
      (r) => String(r.assignedToRef || "") === uid,
    );
    const userInterviews = (interviews as unknown as InterviewForScoring[]).filter(
      (iv) => String(iv.marketingPersonRef || "") === uid,
    );
    const mkt = computeMarketingMetrics({
      assignedReqs: userReqs,
      interviews: userInterviews,
      from,
      to,
    });
    const scoreMkt = scoreMarketing(mkt.metrics, weightsMkt);
    // Support: rebuild from the user's entered reqs (subset of reqs where
    // reqEnteredByRef === uid). Reuse the same fetched set.
    const enteredReqs = (reqs as unknown as ReqForScoring[]).filter(
      (r) => String(r.reqEnteredByRef || "") === uid,
    );
    const clientIvIds = new Set(
      (interviews as unknown as InterviewForScoring[])
        // Only scored interview types count toward Support's "was
        // interviewed" flag — matches the scoring rule so Support and
        // Marketing agree on what constitutes an interview.
        .filter((iv) => isScoredInterview(iv))
        .map((iv) => iv.reqID || "")
        .filter(Boolean),
    );
    const sup = computeSupportMetrics({
      enteredReqs,
      clientInterviewReqIDs: clientIvIds,
      from,
      to,
    });
    const scoreSup = scoreSupport(sup.metrics, weightsSup);

    const role = primaryRole(u.role);
    const primaryScore =
      role === "support"
        ? scoreSup.score
        : role === "marketing"
          ? scoreMkt.score
          : scoreMkt.score + scoreSup.score;
    const offers = userInterviews.filter(
      (iv) =>
        iv._perfOfferAt &&
        (iv._perfOfferAt as Date) >= from &&
        (iv._perfOfferAt as Date) <= to,
    ).length;

    // Sparkline + streak use a lightweight event stream: the perf
    // timestamps on the user's reqs/interviews that fall in the range.
    const perfTimes: Date[] = [];
    const inRange = (d: unknown) =>
      !!d && (d as Date) >= from && (d as Date) <= to;
    for (const r of userReqs) {
      for (const t of [
        r._perfSubmittedAt,
        r._perfInterviewedAt,
        r._perfProjectActiveAt,
      ]) {
        if (inRange(t)) perfTimes.push(t as Date);
      }
    }
    for (const iv of userInterviews) {
      for (const t of [iv._perfConfirmedAt, iv._perfCompletedAt, iv._perfOfferAt]) {
        if (inRange(t)) perfTimes.push(t as Date);
      }
    }

    const sparkBuckets = buildBucketList(from, to, bucket).slice(
      -SPARKLINE_BUCKETS,
    );
    const sparkline = sparkBuckets.map(() => 0);
    for (const t of perfTimes) {
      const b = bucketStart(t, bucket);
      const idx = sparkBuckets.indexOf(b);
      if (idx >= 0) sparkline[idx]++;
    }

    // Active-day streak = consecutive days (ending at `to`) with at least
    // one perf event.
    const daysWithActivity = new Set(perfTimes.map((t) => dayKey(t)));
    let streak = 0;
    const cursor = moment(to).startOf("day");
    while (daysWithActivity.has(cursor.format("YYYY-MM-DD"))) {
      streak++;
      cursor.subtract(1, "day");
    }

    // Per-status counts within the [from, to] window. A req can bump
    // multiple statuses within one window (e.g. Submitted at 10am + hit
    // Interviewed at 3pm the same day) — both are counted, matching the
    // "activity in this window" mental model.
    //
    // Perf-stamped statuses: use their timestamp regardless of current
    // status (a req that hit Submitted in the window still counts even
    // if it's now Interviewed).
    // Non-perf statuses (New Working / In progress / Cancelled): use
    // createdAt or updatedAt, but only when the current status matches
    // (we can't otherwise tell when the transition happened).
    const ownedReqs = (reqs as unknown as Array<Record<string, unknown>>).filter(
      (r) =>
        String(r.assignedToRef || "") === uid ||
        String(r.reqEnteredByRef || "") === uid,
    );
    const statusCounts: Record<string, number> = {};
    const inWindow = (raw: unknown): boolean => {
      if (!raw) return false;
      const d = raw instanceof Date ? raw : new Date(raw as string);
      if (isNaN(d.getTime())) return false;
      return d >= from && d <= to;
    };
    for (const r of ownedReqs) {
      const cur = String(r.reqStatus || "").trim();
      // Every stage tracked by a perf-stamp uses that timestamp — so a
      // req counts under "In Progress" the day it entered that stage,
      // regardless of where it is now.
      if (inWindow(r._perfInProgressAt))
        statusCounts["Submission in progress"] =
          (statusCounts["Submission in progress"] || 0) + 1;
      if (inWindow(r._perfSubmittedAt))
        statusCounts["Submitted"] = (statusCounts["Submitted"] || 0) + 1;
      if (inWindow(r._perfInterviewedAt))
        statusCounts["Interviewed"] = (statusCounts["Interviewed"] || 0) + 1;
      if (inWindow(r._perfProjectActiveAt))
        statusCounts["Project Active"] =
          (statusCounts["Project Active"] || 0) + 1;
      if (inWindow(r._perfProjectInactiveAt))
        statusCounts["Project Inactive"] =
          (statusCounts["Project Inactive"] || 0) + 1;
      // "New Working" has no perf stamp of its own — it's the default
      // status on creation, so createdAt IS the transition timestamp.
      // Count every req created in the window, whether or not it later
      // advanced — mirrors the "hit this stage in window" rule above.
      if (inWindow(r.createdAt))
        statusCounts["New Working"] = (statusCounts["New Working"] || 0) + 1;
      // "Cancelled" has no perf stamp either — closest proxy is
      // updatedAt while the current status is Cancelled.
      if (cur === "Cancelled" && inWindow(r.updatedAt))
        statusCounts["Cancelled"] = (statusCounts["Cancelled"] || 0) + 1;
    }

    return {
      userId: uid,
      role,
      score: Math.round(primaryScore * 100) / 100,
      submissions: mkt.metrics.submissions,
      interviewsConfirmed: mkt.metrics.interviewsConfirmed,
      interviewsCompleted: mkt.metrics.interviewsCompleted,
      offers,
      statusCounts,
      activeDayStreak: streak,
      sparkline,
    };
  });

  // ── Metrics grid — per-metric per-user (for compare table). ──
  const metricsGrid: Record<string, Record<string, number>> = {
    submissions: {},
    interviewsConfirmed: {},
    interviewsCompleted: {},
    offers: {},
    score: {},
    activeDayStreak: {},
  };
  for (const k of kpis) {
    metricsGrid.submissions[k.userId] = k.submissions;
    metricsGrid.interviewsConfirmed[k.userId] = k.interviewsConfirmed;
    metricsGrid.interviewsCompleted[k.userId] = k.interviewsCompleted;
    metricsGrid.offers[k.userId] = k.offers;
    metricsGrid.score[k.userId] = k.score;
    metricsGrid.activeDayStreak[k.userId] = k.activeDayStreak;
  }

  // ── Proactivity Board ──
  const proactivity = await buildProactivityData({
    from,
    to,
    reqFilter,
  });

  // ── Trend series ──
  const trend = await computeTrend({
    reqs: filteredReqIdsForTrend as unknown as ReqForScoring[],
    interviews: allInterviews as unknown as InterviewForScoring[],
    weightsMkt,
    groupBy,
    bucket,
    metric,
    from,
    to,
  });

  return {
    users,
    kpis,
    metricsGrid,
    trend,
    proactivity,
  };
}

// ─── Proactivity data build ─────────────────────────────────────────

interface ProactivityInput {
  from: Date;
  to: Date;
  reqFilter: FilterQuery<Record<string, unknown>>;
}

/**
 * Compute the Proactivity Board bundle.
 *
 * Question the board answers: "for parent reqs entered in [from, to], which
 * marketer acted first?" — where "action" = created a child requirement
 * (primary signal, clean ObjectId + server-stamped timestamp), or was the
 * first entry in the parent's `mComment[]` (secondary signal, name-matched
 * to a user record because `mComment` stores the commenter's name, not
 * their user ref).
 *
 * Ordering: for each parent, actors sorted by earliest action timestamp
 * asc. Ties keep insertion order (rare in practice — ms precision).
 */
async function buildProactivityData(
  input: ProactivityInput,
): Promise<PulseProactivity> {
  const { from, to, reqFilter } = input;

  // 1. Parent reqs entered in the window. Guard `parentReqID` field with
  //    a $or so older docs (field absent) + newer docs ("") both count as
  //    parents.
  const parents = await RequirementModel.find({
    ...reqFilter,
    $or: [{ parentReqID: "" }, { parentReqID: { $exists: false } }],
    createdAt: { $gte: from, $lte: to },
  } as FilterQuery<Record<string, unknown>>)
    .select("reqID jobTitle clientCompany createdAt reqEnteredByRef mComment")
    .sort({ createdAt: -1 })
    .lean();

  if (parents.length === 0) {
    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      totals: { positionsEntered: 0, childrenCreated: 0, unclaimedParents: 0 },
      reqs: [],
      leaderboard: [],
    };
  }

  const parentReqIDs = parents
    .map((p) => (p as { reqID?: string }).reqID)
    .filter(Boolean) as string[];

  // 2. Children of those parents. No date filter on child fetch — a
  //    comment placed on a child after the parent's entry window still
  //    counts as an action on that (in-window) parent. mComment carries
  //    the commenter's display name (not a ref), so we resolve names to
  //    userIds via the active-user roster loaded below.
  const children = await RequirementModel.find({
    parentReqID: { $in: parentReqIDs },
  } as FilterQuery<Record<string, unknown>>)
    .select("reqID parentReqID assignedToRef createdAt mComment")
    .lean();

  // 3. Resolve users referenced by reqEnteredByRef on parents +
  //    assignedToRef on children (used only for display in the
  //    per-position table). Also fetch the active user roster for
  //    mComment name-matching (that's what actually decides actors).
  const supportIds = new Set<string>();
  for (const p of parents) {
    const uid = (p as { reqEnteredByRef?: unknown }).reqEnteredByRef;
    if (uid) supportIds.add(String(uid));
  }
  const marketerIds = new Set<string>();
  for (const c of children) {
    const uid = (c as { assignedToRef?: unknown }).assignedToRef;
    if (uid) marketerIds.add(String(uid));
  }
  const directIds = Array.from(new Set([...supportIds, ...marketerIds]))
    .filter((s) => Types.ObjectId.isValid(s))
    .map((s) => new Types.ObjectId(s));

  const [directUsers, allActiveUsers] = await Promise.all([
    directIds.length
      ? UserModel.find({ _id: { $in: directIds } })
          .select("firstName lastName email role")
          .lean()
      : Promise.resolve([]),
    // Marketing-only roster — proactivity ranks who acted on the client
    // pipeline; support staff commenting on internal notes shouldn't
    // register as "first actor". A support-only user's comment gets
    // silently ignored.
    UserModel.find({ active: true, role: UserRole.Marketing })
      .select("firstName lastName email role")
      .lean(),
  ]);

  const userById = new Map<string, { userId: string; name: string }>();
  for (const u of directUsers) {
    // Skip support-only entries here too so the per-position table + the
    // `enteredBy` fallback don't attribute marketing action to a
    // support user pulled in only via `reqEnteredByRef` on the parent.
    // We still keep them for the "entered by" column via a separate
    // `supportUserById` map computed below.
    userById.set(String(u._id), {
      userId: String(u._id),
      name: displayName(u),
    });
  }
  // Roster used for name-string → userId mapping on mComment entries.
  // Only marketers land in this map because `allActiveUsers` is
  // marketing-role-only above.
  const userByName = new Map<string, { userId: string; name: string }>();
  for (const u of allActiveUsers) {
    const n = displayName(u).toLowerCase();
    // If two users share the same normalised name, the first wins (rare —
    // and the ambiguity would also be a real product problem).
    if (!userByName.has(n)) {
      userByName.set(n, { userId: String(u._id), name: displayName(u) });
    }
  }

  // 4. Bucket children under their parent — we need every child's
  //    mComment list to determine actors.
  type ChildLite = {
    reqID?: string;
    assignedToRef?: unknown;
    mComment?: Array<{ username?: string; date?: Date | string }>;
  };
  const childrenByParent = new Map<string, ChildLite[]>();
  for (const c of children) {
    const p = (c as { parentReqID?: string }).parentReqID;
    if (!p) continue;
    if (!childrenByParent.has(p)) childrenByParent.set(p, []);
    childrenByParent.get(p)!.push(c as ChildLite);
  }

  // 5. Per parent, gather actor events — a "first action" is the first
  //    comment (mComment[]) added on any child of that parent. A
  //    marketer who was assigned a child but never commented does NOT
  //    count as an actor.
  const reqsOut: PulseProactivityReq[] = [];
  let unclaimedParents = 0;

  for (const parent of parents) {
    const p = parent as {
      reqID?: string;
      jobTitle?: string;
      clientCompany?: string;
      createdAt?: Date;
      reqEnteredByRef?: unknown;
    };
    if (!p.reqID || !p.createdAt) continue;
    const enteredAt = p.createdAt as Date;

    // Actor bucket: userId → { earliest comment date, childReqID it was on }
    const perUser = new Map<
      string,
      { at: Date; childReqID?: string }
    >();

    const bump = (
      userId: string,
      raw: Date | string | number | undefined,
      childReqID: string | undefined,
    ) => {
      // Legacy `mComment[].date` rows can be plain strings — Mongoose
      // doesn't coerce them retroactively. Normalise to Date so
      // downstream `toISOString()`/`getTime()` are always safe.
      if (raw === undefined || raw === null) return;
      const at = raw instanceof Date ? raw : new Date(raw);
      if (isNaN(at.getTime())) return;
      const prev = perUser.get(userId);
      if (!prev || at < prev.at) {
        perUser.set(userId, { at, childReqID });
      }
    };

    // Comments on children only. (Parent comments intentionally
    // ignored — the product rule is "first comment on a child req".)
    const cs = childrenByParent.get(p.reqID) || [];
    for (const c of cs) {
      const comments = Array.isArray(c.mComment) ? c.mComment : [];
      for (const cm of comments) {
        const name = (cm.username || "").trim().toLowerCase();
        if (!name || !cm.date) continue;
        const u = userByName.get(name);
        if (!u) continue; // unresolvable → silently drop
        bump(u.userId, cm.date, c.reqID);
      }
    }

    const actors: PulseProactivityActor[] = [];
    for (const [uid, entry] of perUser.entries()) {
      const u =
        userById.get(uid) ||
        Array.from(userByName.values()).find((r) => r.userId === uid);
      const name = u?.name || uid;
      actors.push({
        userId: uid,
        name,
        firstActionAt: entry.at.toISOString(),
        firstActionKind: "comment",
        childReqID: entry.childReqID,
        msFromEntry: Math.max(0, entry.at.getTime() - enteredAt.getTime()),
      });
    }
    actors.sort((a, b) => a.firstActionAt.localeCompare(b.firstActionAt));

    if (actors.length === 0) unclaimedParents++;

    const supUser = p.reqEnteredByRef
      ? userById.get(String(p.reqEnteredByRef))
      : undefined;
    reqsOut.push({
      parentReqID: p.reqID,
      jobTitle: p.jobTitle || "",
      clientCompany: p.clientCompany || "",
      enteredAt: enteredAt.toISOString(),
      enteredBy: {
        userId: supUser?.userId,
        name: supUser?.name || "—",
      },
      actors,
    });
  }

  // Cap the per-position table (leaderboard aggregates over the full set).
  const cappedReqs = reqsOut.slice(0, PROACTIVITY_REQ_CAP);

  // 6. Leaderboard aggregation over ALL parents (not the cap).
  const stats = new Map<
    string,
    {
      name: string;
      firstPlaceCount: number;
      secondPlaceCount: number;
      thirdOrLaterCount: number;
      totalActedOn: number;
      msSamples: number[];
    }
  >();
  for (const r of reqsOut) {
    r.actors.forEach((actor, rank) => {
      let s = stats.get(actor.userId);
      if (!s) {
        s = {
          name: actor.name,
          firstPlaceCount: 0,
          secondPlaceCount: 0,
          thirdOrLaterCount: 0,
          totalActedOn: 0,
          msSamples: [],
        };
        stats.set(actor.userId, s);
      }
      s.totalActedOn++;
      s.msSamples.push(actor.msFromEntry);
      if (rank === 0) s.firstPlaceCount++;
      else if (rank === 1) s.secondPlaceCount++;
      else s.thirdOrLaterCount++;
    });
  }
  const leaderboard: PulseProactivityLeader[] = Array.from(stats.entries()).map(
    ([userId, s]) => {
      const sorted = [...s.msSamples].sort((a, b) => a - b);
      const median =
        sorted.length === 0
          ? null
          : sorted.length % 2 === 1
            ? sorted[(sorted.length - 1) / 2]
            : Math.round((sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2);
      return {
        userId,
        name: s.name,
        firstPlaceCount: s.firstPlaceCount,
        secondPlaceCount: s.secondPlaceCount,
        thirdOrLaterCount: s.thirdOrLaterCount,
        totalActedOn: s.totalActedOn,
        medianMsToAct: median,
      };
    },
  );
  leaderboard.sort((a, b) => {
    if (b.firstPlaceCount !== a.firstPlaceCount)
      return b.firstPlaceCount - a.firstPlaceCount;
    const ma = a.medianMsToAct ?? Number.POSITIVE_INFINITY;
    const mb = b.medianMsToAct ?? Number.POSITIVE_INFINITY;
    return ma - mb;
  });

  return {
    window: { from: from.toISOString(), to: to.toISOString() },
    totals: {
      positionsEntered: parents.length,
      childrenCreated: children.length,
      unclaimedParents,
    },
    reqs: cappedReqs,
    leaderboard,
  };
}

// ─── Trend computation (Section 6) ──────────────────────────────────

interface TrendArgs {
  reqs: ReqForScoring[];
  interviews: InterviewForScoring[];
  weightsMkt: Record<string, number>;
  groupBy: PulseGroupBy;
  bucket: PulseBucket;
  metric: PulseMetric;
  from: Date;
  to: Date;
}

async function computeTrend(args: TrendArgs): Promise<PulseTrend> {
  const { reqs, interviews, groupBy, bucket, metric, from, to, weightsMkt } = args;
  const xAxis = buildBucketList(from, to, bucket);

  // Build reqID → raw group value map first.
  const reqRawGroup = new Map<string, string>();
  const reqById = new Map<string, ReqForScoring>();
  for (const r of reqs) {
    if (!r.reqID) continue;
    reqById.set(r.reqID, r);
    const val = extractGroupValue(r, groupBy);
    if (val) reqRawGroup.set(r.reqID, val);
  }

  // Canonicalise the raws for text-typed group fields so seniority /
  // spelling variants collapse into a single line. Array-typed fields
  // (taxType, remote, employementType) skip this pass — they're already
  // small enums.
  const canonicaliseFields: Record<PulseGroupBy, boolean> = {
    jobTitle: true,
    primaryTech: true,
    secondaryTech: true,
    primaryTechStack: true,
    clientCompany: true,
    employementType: false,
    taxType: false,
    remote: false,
  };
  const reqGroup = new Map<string, string>();
  if (canonicaliseFields[groupBy]) {
    const uniqueRaws = Array.from(new Set(reqRawGroup.values()));
    const canonMap = await resolveTitles(
      uniqueRaws,
      groupBy as CanonicalGroupType,
    );
    for (const [reqID, raw] of reqRawGroup.entries()) {
      const c = canonMap.get(raw.trim().toLowerCase());
      reqGroup.set(reqID, c || raw);
    }
  } else {
    for (const [reqID, raw] of reqRawGroup.entries()) reqGroup.set(reqID, raw);
  }

  // For positions → count reqs by createdAt in window.
  // For submissions/score → use req._perfSubmittedAt.
  // For interviewsCompleted → use interview._perfCompletedAt keyed to req.
  // For offers → interview._perfOfferAt keyed to req.
  const seriesMap = new Map<string, number[]>();
  const bumpSeries = (group: string, bucketISO: string, amount = 1) => {
    const idx = xAxis.indexOf(bucketISO);
    if (idx < 0) return;
    if (!seriesMap.has(group)) seriesMap.set(group, xAxis.map(() => 0));
    (seriesMap.get(group) as number[])[idx] += amount;
  };
  const w = (k: string, d = 0) =>
    Number.isFinite(weightsMkt[k]) ? weightsMkt[k] : d;
  const subWeight = w("SUBMISSION_WEIGHT", 2);
  const intWeight = w("INTERVIEW_COMPLETED_WEIGHT", 10);

  const wantPositions = metric === "positions";
  const wantSubs = metric === "submissions" || metric === "score";
  const wantIntComp = metric === "interviewsCompleted" || metric === "score";
  const wantOffers = metric === "offers";

  if (wantPositions) {
    for (const r of reqs) {
      const rec = r as unknown as Record<string, unknown>;
      const rawAt = rec.createdAt;
      if (!rawAt) continue;
      const t = rawAt instanceof Date ? rawAt : new Date(rawAt as string);
      if (isNaN(t.getTime()) || t < from || t > to) continue;
      const group = reqGroup.get(r.reqID || "");
      if (!group) continue;
      bumpSeries(group, bucketStart(t, bucket), 1);
    }
  }

  if (wantSubs) {
    for (const r of reqs) {
      const at = r._perfSubmittedAt;
      if (!at) continue;
      const t = at as Date;
      if (t < from || t > to) continue;
      const group = reqGroup.get(r.reqID || "");
      if (!group) continue;
      const amount = metric === "score" ? subWeight : 1;
      bumpSeries(group, bucketStart(t, bucket), amount);
    }
  }

  if (wantIntComp) {
    for (const iv of interviews) {
      if (!isScoredInterview(iv)) continue;
      const at = iv._perfCompletedAt;
      if (!at) continue;
      const t = at as Date;
      if (t < from || t > to) continue;
      const req = iv.reqID ? reqById.get(iv.reqID) : undefined;
      if (!req) continue;
      const group = reqGroup.get(iv.reqID || "");
      if (!group) continue;
      const amount = metric === "score" ? intWeight : 1;
      bumpSeries(group, bucketStart(t, bucket), amount);
    }
  }

  if (wantOffers) {
    for (const iv of interviews) {
      if (!isScoredInterview(iv)) continue;
      const at = iv._perfOfferAt;
      if (!at) continue;
      const t = at as Date;
      if (t < from || t > to) continue;
      const req = iv.reqID ? reqById.get(iv.reqID) : undefined;
      if (!req) continue;
      const group = reqGroup.get(iv.reqID || "");
      if (!group) continue;
      bumpSeries(group, bucketStart(t, bucket), 1);
    }
  }

  // Top-N series by total.
  const totalsByGroup: Array<[string, number]> = [];
  for (const [name, data] of seriesMap.entries()) {
    const total = data.reduce((s, n) => s + n, 0);
    totalsByGroup.push([name, total]);
  }
  totalsByGroup.sort((a, b) => b[1] - a[1]);
  const kept = totalsByGroup.slice(0, TREND_TOP_N);
  const truncated = totalsByGroup.length > TREND_TOP_N;
  const series: PulseTrendSeries[] = kept.map(([name]) => ({
    name,
    data: seriesMap.get(name) as number[],
  }));

  return {
    groupBy,
    bucket,
    metric,
    xAxis,
    series,
    truncated,
    totalSeries: totalsByGroup.length,
  };
}

function extractGroupValue(
  r: ReqForScoring,
  groupBy: PulseGroupBy,
): string | undefined {
  const record = r as unknown as Record<string, unknown>;
  const raw = record[groupBy];
  if (Array.isArray(raw)) {
    // taxType / remote are arrays — pick the first non-empty element's
    // value/label.
    for (const item of raw) {
      if (!item) continue;
      if (typeof item === "string") return item;
      if (typeof item === "object" && item !== null) {
        const v = (item as { value?: string; label?: string }).value ||
          (item as { label?: string }).label;
        if (v) return v;
      }
    }
    return undefined;
  }
  if (typeof raw === "string") return raw.trim() || undefined;
  return undefined;
}

// ─── Status drilldown ───────────────────────────────────────────────

/**
 * Build the Mongo filter fragment that pulls the reqs which entered the
 * requested status within [from, to]. Mirrors the in-memory logic used
 * by KPI statusCounts so counts + drilldown always agree.
 *
 * Returns `null` for unrecognised statuses so the controller can 400.
 */
function statusDrilldownFilter(
  status: string,
  from: Date,
  to: Date,
): { filter: FilterQuery<Record<string, unknown>>; relevantField: string } | null {
  const win = { $gte: from, $lte: to };
  switch (status) {
    case "Submitted":
      return { filter: { _perfSubmittedAt: win }, relevantField: "_perfSubmittedAt" };
    case "Interviewed":
      return { filter: { _perfInterviewedAt: win }, relevantField: "_perfInterviewedAt" };
    case "Project Active":
      return {
        filter: { _perfProjectActiveAt: win },
        relevantField: "_perfProjectActiveAt",
      };
    case "Project Inactive":
      return {
        filter: { _perfProjectInactiveAt: win },
        relevantField: "_perfProjectInactiveAt",
      };
    case "New Working":
      // No current-status gate — a req counts under New Working the day
      // it was created, even if it has since advanced. Matches KPI card
      // logic.
      return {
        filter: { createdAt: win },
        relevantField: "createdAt",
      };
    case "Submission in progress":
      return {
        filter: { _perfInProgressAt: win },
        relevantField: "_perfInProgressAt",
      };
    case "Cancelled":
      return {
        filter: { reqStatus: "Cancelled", updatedAt: win },
        relevantField: "updatedAt",
      };
    default:
      return null;
  }
}

export async function buildStatusDrilldown(input: {
  userId: string;
  statusKey: string;
  from: Date;
  to: Date;
  reqFilter?: PulseReqFilter;
}): Promise<PulseStatusDrilldownReq[]> {
  if (!Types.ObjectId.isValid(input.userId)) return [];
  const uid = new Types.ObjectId(input.userId);
  const built = statusDrilldownFilter(input.statusKey, input.from, input.to);
  if (!built) return [];
  const reqFilter = buildReqFilterQuery(input.reqFilter);
  const query: FilterQuery<Record<string, unknown>> = {
    $and: [
      reqFilter,
      built.filter,
      { $or: [{ assignedToRef: uid }, { reqEnteredByRef: uid }] },
    ],
  };
  const rows = await RequirementModel.find(query)
    .select(
      "reqID reqStatus jobTitle clientCompany primaryTech createdAt updatedAt _perfSubmittedAt _perfInterviewedAt _perfProjectActiveAt _perfProjectInactiveAt",
    )
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean();
  const field = built.relevantField as PulseStatusDrilldownReq["relevantField"];
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    const relevantRaw = rec[field];
    const relevantAt =
      relevantRaw instanceof Date
        ? relevantRaw.toISOString()
        : typeof relevantRaw === "string"
          ? relevantRaw
          : "";
    return {
      reqID: String(rec.reqID || ""),
      reqStatus: String(rec.reqStatus || ""),
      jobTitle: String(rec.jobTitle || ""),
      clientCompany: String(rec.clientCompany || ""),
      primaryTech: rec.primaryTech ? String(rec.primaryTech) : undefined,
      createdAt:
        rec.createdAt instanceof Date
          ? rec.createdAt.toISOString()
          : String(rec.createdAt || ""),
      updatedAt:
        rec.updatedAt instanceof Date
          ? rec.updatedAt.toISOString()
          : String(rec.updatedAt || ""),
      relevantAt,
      relevantField: field,
    };
  });
}
