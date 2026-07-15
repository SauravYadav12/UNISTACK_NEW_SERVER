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
  ReqForScoring,
  InterviewForScoring,
} from "../utils/scoring";
import {
  DEFAULT_MARKETING_WEIGHTS,
  DEFAULT_SUPPORT_WEIGHTS,
  PerformanceWeightsModel,
} from "../models/performanceWeightsModel";
import { UserRole } from "../enums/UserEnum";

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
  perEmployeeOverlay?: Array<{ userId: string; name: string; data: number[] }>;
}

// ─── Proactivity Board types ───────────────────────────────────────

export interface PulseProactivityActor {
  userId: string;
  name: string;
  firstActionAt: string; // ISO
  firstActionKind: "child" | "comment";
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
    out.push(cursor.format("YYYY-MM-DD"));
    if (bucket === "day") cursor.add(1, "day");
    else if (bucket === "week") cursor.add(1, "week");
    else if (bucket === "biweek") cursor.add(2, "week");
    else cursor.add(1, "month");
  }
  return out;
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
  const metric: PulseMetric = input.metric || "submissions";

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
    "reqID reqStatus assignedToRef reqEnteredByRef parentReqID childSuffix isDuplicate jobTitle primaryTech secondaryTech primaryTechStack clientCompany employementType taxType remote starColor createdAt updatedAt _perfSubmittedAt _perfInterviewedAt _perfProjectActiveAt _perfProjectInactiveAt _perfStaleSubmissionFiredAt _perfUnworkedPenaltyFiredAt _perfUnprogressedPenaltyFiredAt";

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
    // Trend query — respects requirement filter, no user scoping (chart
    // works even with zero employees selected).
    RequirementModel.find(reqFilter)
      .select(
        "reqID jobTitle primaryTech secondaryTech primaryTechStack clientCompany employementType taxType remote assignedToRef createdAt _perfSubmittedAt _perfInterviewedAt _perfProjectActiveAt",
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
        .filter((iv) => iv.interviewWith === "Client")
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

    // Snapshot counts by current reqStatus. Union of `assignedToRef`
    // and `reqEnteredByRef` matches (a req the user owns in either lane
    // is counted once).
    const ownedReqs = (reqs as unknown as Array<{
      assignedToRef?: unknown;
      reqEnteredByRef?: unknown;
      reqStatus?: string;
      _id?: unknown;
    }>).filter(
      (r) =>
        String(r.assignedToRef || "") === uid ||
        String(r.reqEnteredByRef || "") === uid,
    );
    const statusCounts: Record<string, number> = {};
    for (const r of ownedReqs) {
      const s = (r.reqStatus || "").trim();
      if (!s) continue;
      statusCounts[s] = (statusCounts[s] || 0) + 1;
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
  const trend = computeTrend({
    reqs: filteredReqIdsForTrend as unknown as ReqForScoring[],
    interviews: allInterviews as unknown as InterviewForScoring[],
    weightsMkt,
    groupBy,
    bucket,
    metric,
    from,
    to,
    userIds: userIds.map(String),
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

  // 2. Children of those parents. No date filter on child fetch — a child
  //    created after the window still counts as an action on its (in-window)
  //    parent.
  const children = await RequirementModel.find({
    parentReqID: { $in: parentReqIDs },
  } as FilterQuery<Record<string, unknown>>)
    .select("reqID parentReqID assignedToRef createdAt")
    .lean();

  // 3. Resolve users referenced by (a) reqEnteredByRef on parents, (b)
  //    assignedToRef on children. Also fetch the active user roster once
  //    for mComment name-matching.
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
          .select("firstName lastName email")
          .lean()
      : Promise.resolve([]),
    UserModel.find({ active: true })
      .select("firstName lastName email")
      .lean(),
  ]);

  const userById = new Map<string, { userId: string; name: string }>();
  for (const u of directUsers) {
    userById.set(String(u._id), {
      userId: String(u._id),
      name: displayName(u),
    });
  }
  // Roster used for name-string → userId mapping on mComment entries.
  const userByName = new Map<string, { userId: string; name: string }>();
  for (const u of allActiveUsers) {
    const n = displayName(u).toLowerCase();
    // If two users share the same normalised name, the first wins (rare —
    // and the ambiguity would also be a real product problem).
    if (!userByName.has(n)) {
      userByName.set(n, { userId: String(u._id), name: displayName(u) });
    }
  }

  // 4. Bucket children under their parent for the actor computation.
  const childrenByParent = new Map<
    string,
    Array<{ assignedToRef?: unknown; createdAt?: Date }>
  >();
  for (const c of children) {
    const p = (c as { parentReqID?: string }).parentReqID;
    if (!p) continue;
    if (!childrenByParent.has(p)) childrenByParent.set(p, []);
    childrenByParent.get(p)!.push(
      c as { assignedToRef?: unknown; createdAt?: Date },
    );
  }

  // 5. Per parent, gather all actor events, keep min per user, sort asc.
  const reqsOut: PulseProactivityReq[] = [];
  let unclaimedParents = 0;

  for (const parent of parents) {
    const p = parent as {
      reqID?: string;
      jobTitle?: string;
      clientCompany?: string;
      createdAt?: Date;
      reqEnteredByRef?: unknown;
      mComment?: Array<{ username?: string; date?: Date | string }>;
    };
    if (!p.reqID || !p.createdAt) continue;
    const enteredAt = p.createdAt as Date;

    // Actor bucket: userId → { firstActionAt, firstActionKind }
    const perUser = new Map<
      string,
      { at: Date; kind: "child" | "comment" }
    >();

    const bump = (
      userId: string,
      raw: Date | string | number | undefined,
      kind: "child" | "comment",
    ) => {
      // Legacy `mComment[].date` rows can be plain strings — Mongoose
      // doesn't coerce them retroactively. Normalise to Date here so
      // downstream `toISOString()`/`getTime()` are always safe.
      if (raw === undefined || raw === null) return;
      const at = raw instanceof Date ? raw : new Date(raw);
      if (isNaN(at.getTime())) return;
      const prev = perUser.get(userId);
      if (!prev || at < prev.at) {
        perUser.set(userId, { at, kind });
      }
    };

    // Child creations
    const cs = childrenByParent.get(p.reqID) || [];
    for (const c of cs) {
      const uid = c.assignedToRef ? String(c.assignedToRef) : "";
      if (!uid || !c.createdAt) continue;
      bump(uid, c.createdAt as Date | string, "child");
    }

    // Comments — name-match to user roster.
    const comments = Array.isArray(p.mComment) ? p.mComment : [];
    for (const cm of comments) {
      const name = (cm.username || "").trim().toLowerCase();
      const d = cm.date;
      if (!name || !d) continue;
      const u = userByName.get(name);
      if (!u) continue; // unresolvable → silently drop
      bump(u.userId, d as Date | string, "comment");
    }

    const actors: PulseProactivityActor[] = [];
    for (const [uid, entry] of perUser.entries()) {
      const u = userById.get(uid) || userByName.get(
        // Fall back to roster lookup if this user wasn't in the direct
        // users batch (can happen when the user only appears via a
        // comment, not via a child assignment).
        Array.from(userByName.values()).find((r) => r.userId === uid)?.name.toLowerCase() || "",
      );
      const name = u?.name || (u as { name?: string } | undefined)?.name || uid;
      actors.push({
        userId: uid,
        name,
        firstActionAt: (entry.at as Date).toISOString(),
        firstActionKind: entry.kind,
        msFromEntry: Math.max(0, (entry.at as Date).getTime() - enteredAt.getTime()),
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
  userIds: string[];
}

function computeTrend(args: TrendArgs): PulseTrend {
  const { reqs, interviews, groupBy, bucket, metric, from, to, userIds, weightsMkt } = args;
  const xAxis = buildBucketList(from, to, bucket);

  // Build reqID → group value map from the trend req set.
  const reqGroup = new Map<string, string>();
  const reqById = new Map<string, ReqForScoring>();
  for (const r of reqs) {
    if (!r.reqID) continue;
    reqById.set(r.reqID, r);
    const val = extractGroupValue(r, groupBy);
    if (val) reqGroup.set(r.reqID, val);
  }

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
  const overlayMap = new Map<string, number[]>(); // userId → per-bucket count
  const bumpOverlay = (userId: string, bucketISO: string, amount = 1) => {
    const idx = xAxis.indexOf(bucketISO);
    if (idx < 0) return;
    if (!overlayMap.has(userId)) overlayMap.set(userId, xAxis.map(() => 0));
    (overlayMap.get(userId) as number[])[idx] += amount;
  };

  const w = (k: string, d = 0) =>
    Number.isFinite(weightsMkt[k]) ? weightsMkt[k] : d;
  const subWeight = w("SUBMISSION_WEIGHT", 2);
  const intWeight = w("INTERVIEW_COMPLETED_WEIGHT", 10);

  const wantSubs = metric === "submissions" || metric === "score";
  const wantIntComp = metric === "interviewsCompleted" || metric === "score";
  const wantOffers = metric === "offers";

  if (wantSubs) {
    for (const r of reqs) {
      const at = r._perfSubmittedAt;
      if (!at) continue;
      const t = at as Date;
      if (t < from || t > to) continue;
      const group = reqGroup.get(r.reqID || "");
      if (!group) continue;
      const bucketISO = bucketStart(t, bucket);
      const amount = metric === "score" ? subWeight : 1;
      bumpSeries(group, bucketISO, amount);
      const uid = String(r.assignedToRef || "");
      if (uid && userIds.includes(uid)) bumpOverlay(uid, bucketISO, amount);
    }
  }

  if (wantIntComp) {
    for (const iv of interviews) {
      if (iv.interviewWith !== "Client") continue;
      const at = iv._perfCompletedAt;
      if (!at) continue;
      const t = at as Date;
      if (t < from || t > to) continue;
      const req = iv.reqID ? reqById.get(iv.reqID) : undefined;
      if (!req) continue;
      const group = reqGroup.get(iv.reqID || "");
      if (!group) continue;
      const bucketISO = bucketStart(t, bucket);
      const amount = metric === "score" ? intWeight : 1;
      bumpSeries(group, bucketISO, amount);
      const uid = String(iv.marketingPersonRef || "");
      if (uid && userIds.includes(uid)) bumpOverlay(uid, bucketISO, amount);
    }
  }

  if (wantOffers) {
    for (const iv of interviews) {
      if (iv.interviewWith !== "Client") continue;
      const at = iv._perfOfferAt;
      if (!at) continue;
      const t = at as Date;
      if (t < from || t > to) continue;
      const req = iv.reqID ? reqById.get(iv.reqID) : undefined;
      if (!req) continue;
      const group = reqGroup.get(iv.reqID || "");
      if (!group) continue;
      const bucketISO = bucketStart(t, bucket);
      bumpSeries(group, bucketISO, 1);
      const uid = String(iv.marketingPersonRef || "");
      if (uid && userIds.includes(uid)) bumpOverlay(uid, bucketISO, 1);
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

  const perEmployeeOverlay: PulseTrend["perEmployeeOverlay"] = userIds.length
    ? userIds.map((uid) => ({
        userId: uid,
        name: uid, // controller replaces with real name
        data: overlayMap.get(uid) || xAxis.map(() => 0),
      }))
    : undefined;

  return {
    groupBy,
    bucket,
    metric,
    xAxis,
    series,
    truncated,
    totalSeries: totalsByGroup.length,
    perEmployeeOverlay,
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
