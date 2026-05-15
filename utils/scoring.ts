/**
 * Pure scoring math for Marketing + Support performance.
 *
 * Monotonic event-timestamp model: every scoring-worthy state transition
 * stamps a `_perf*At` timestamp on the doc at the moment it happened. This
 * file reads those timestamps and counts events whose stamp falls inside the
 * leaderboard's date window. Result: once a point is awarded, it stays in
 * the period it landed in — moving a req further forward, or cleaning up a
 * stale submission later, never retroactively edits past leaderboards.
 *
 * The pre-monotonic code re-derived state from the doc's current fields on
 * every read. Two consequences fixed here:
 *   1. Confirm + Complete now stack additively (the prior best-status-wins
 *      rule meant Complete silently replaced Confirm — a perceived "−3
 *      deduction" the moment the interview was marked Completed).
 *   2. Penalties are set-once on the doc by the daily cron and survive
 *      remediation. A stale-submission penalty fired in May stays in May's
 *      leaderboard even if the marketer fixes the req in June.
 *
 * Exception to (2): the "unworked requirement" penalty
 * (`_perfUnworkedPenaltyFiredAt`) is intentionally NON-monotonic. Per
 * product rule it represents current stagnation, not a permanent strike,
 * so the moment the marketer moves the req out of "New Working" the field
 * is `$unset` (see `clearReqUnworkedPenalty` in `utils/perfStamps.ts`) and
 * the −1 disappears from every leaderboard window. All other penalties
 * (stale-submission, stale-confirmed-interview, support unprogressed)
 * keep their stamps once fired.
 *
 * Everything here is side-effect-free and Mongoose-free so the controller
 * fetches data once, hands plain objects in, and the math stays easy to
 * test. Each scored metric carries a `label` and `points` so the UI can
 * render the breakdown without recomputing.
 */

export interface ScoreLine {
  /** Snake-case metric key (matches the weights map). */
  key: string;
  /** Human label shown in the UI. */
  label: string;
  /** Raw count before weighting. */
  count: number;
  /** Weight that was applied. */
  weight: number;
  /** `count * weight`, rounded to 2 decimals. */
  points: number;
  /** Positive contribution vs. penalty — UI colours these differently. */
  kind: "positive" | "penalty";
}

export interface ScoreResult {
  score: number;
  rawTotal: number; // before the max(0, ...) floor; useful for debugging
  breakdown: ScoreLine[];
}

/**
 * A single record that contributed to a metric — used by the UI to show
 * *why* a marketer/supporter earned the points and to link out to the
 * requirement or interview. Either `reqID` or `intId` (or both, for
 * interview contributors) is populated.
 */
export interface ContributorItem {
  type: "requirement" | "interview";
  reqID?: string;
  intId?: string;
}

/** Map of metric key (matches ScoreLine.key) → contributing records. */
export type Contributors = Record<string, ContributorItem[]>;

function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function inWindow(
  ts: Date | string | undefined,
  from: Date,
  to: Date,
): boolean {
  if (!ts) return false;
  const t = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(t.getTime())) return false;
  return t >= from && t <= to;
}

// ── Marketing ────────────────────────────────────────────────────────────

export interface MarketingMetrics {
  submissions: number;
  /** Reached "Interview Confirm" at some point — sticks even if the
   *  interview later progressed to Completed. Per-req cap of 1. */
  interviewsConfirmed: number;
  /** Reached "Interview Completed" at some point. Independent of
   *  Confirmed — both fire when both happened. Per-req cap of 1. */
  interviewsCompleted: number;
  /** Stale-confirmed penalty fired by the daily cron (set-once,
   *  survives remediation). Per-interview. */
  staleConfirmedInterviews: number;
  staleSubmissions: number;
  unworkedRequirements: number;
  /** (confirmed + completed) / max(submissions,1) × 100 — client-only. */
  conversionPct: number;
}

/**
 * Requirement shape the function needs — kept permissive so the caller can
 * pass lean docs from either the live or archive collection. The new
 * `_perf*At` fields drive the monotonic scoring; falling back to status +
 * `updatedAt`/`createdAt` keeps pre-migration docs scoring correctly.
 */
export interface ReqForScoring {
  _id?: unknown;
  reqID?: string;
  reqStatus?: string;
  assignedToRef?: unknown;
  reqEnteredByRef?: unknown;
  isDuplicate?: string;
  parentReqID?: string;
  childSuffix?: string;
  createdAt?: Date | string;
  updatedAt?: Date | string;
  // Event timestamps — present on docs that have been written-to since
  // the monotonic-scoring landing; backfilled for older docs from
  // `updatedAt` by the migration script.
  _perfSubmittedAt?: Date | string;
  _perfInterviewedAt?: Date | string;
  _perfProjectActiveAt?: Date | string;
  _perfProjectInactiveAt?: Date | string;
  _perfStaleSubmissionFiredAt?: Date | string;
  _perfUnworkedPenaltyFiredAt?: Date | string;
  _perfUnprogressedPenaltyFiredAt?: Date | string;
}

export interface InterviewForScoring {
  _id?: unknown;
  intId?: string;
  reqID?: string;
  marketingPersonRef?: unknown;
  interviewStatus?: string;
  /** Only "Client" interviews count toward marketing performance. */
  interviewWith?: string;
  /** Scheduled interview date — only used by the legacy fallback when a
   *  client interview is in "Interview Confirm" but the cron hasn't
   *  stamped `_perfStaleConfirmFiredAt` yet (e.g. pre-migration). */
  interviewDate?: Date | string;
  createdAt?: Date | string;
  _perfConfirmedAt?: Date | string;
  _perfCompletedAt?: Date | string;
  _perfOfferAt?: Date | string;
  _perfStaleConfirmFiredAt?: Date | string;
}

export const SUBMITTED_OR_BEYOND = new Set([
  "Submitted",
  "Interviewed",
  "Project Active",
  "Project Inactive",
]);
export const INTERVIEWED_OR_BEYOND = new Set(["Interviewed", "Project Active"]);

const CONFIRMED_STATUS = "Interview Confirm";
const COMPLETED_STATUS = "Interview Completed";
/** Only client-facing interviews feed the performance rollups. Vendor + IMP
 *  interviews are preparation, not the deliverable. */
const CLIENT_INTERVIEW_WITH = "Client";

/** Score a marketing user from their assigned requirements + interviews. */
export function computeMarketingMetrics(args: {
  assignedReqs: ReqForScoring[];
  interviews: InterviewForScoring[];
  /** Leaderboard window — events whose `_perf*At` falls inside count. */
  from: Date;
  to: Date;
}): { metrics: MarketingMetrics; contributors: Contributors } {
  const { from, to } = args;

  let submissions = 0;
  let staleSubmissions = 0;
  let unworkedRequirements = 0;
  const submissionsContrib: ContributorItem[] = [];
  const staleSubmissionsContrib: ContributorItem[] = [];
  const unworkedRequirementsContrib: ContributorItem[] = [];

  for (const r of args.assignedReqs) {
    // Submission count: event-timestamp first; legacy fallback uses status
    // + createdAt window so docs missed by the backfill still register.
    const submittedAt = r._perfSubmittedAt;
    const legacySubmission =
      !submittedAt &&
      SUBMITTED_OR_BEYOND.has(r.reqStatus || "") &&
      inWindow(r.createdAt, from, to);
    if (inWindow(submittedAt, from, to) || legacySubmission) {
      submissions++;
      if (r.reqID)
        submissionsContrib.push({ type: "requirement", reqID: r.reqID });
    }

    // Penalty counts: only count if the `_firedAt` stamp falls in the
    // window. Recovered reqs keep the penalty in the period it fired.
    if (inWindow(r._perfStaleSubmissionFiredAt, from, to)) {
      staleSubmissions++;
      if (r.reqID)
        staleSubmissionsContrib.push({ type: "requirement", reqID: r.reqID });
    }
    if (inWindow(r._perfUnworkedPenaltyFiredAt, from, to)) {
      unworkedRequirements++;
      if (r.reqID)
        unworkedRequirementsContrib.push({
          type: "requirement",
          reqID: r.reqID,
        });
    }
  }

  // ── Interview points: Confirm and Complete are independent counters,
  // each capped at 1 per (marketer, req) pair. A req that went Confirm →
  // Complete contributes both credits additively (was best-status-wins).
  // Interviews without a reqID fall into an "orphan" bucket so legacy data
  // still counts each interview individually.
  const interviewsByReq = new Map<string, InterviewForScoring[]>();
  const orphans: InterviewForScoring[] = [];
  for (const iv of args.interviews) {
    if (iv.interviewWith !== CLIENT_INTERVIEW_WITH) continue;
    if (iv.reqID) {
      const arr = interviewsByReq.get(iv.reqID) || [];
      arr.push(iv);
      interviewsByReq.set(iv.reqID, arr);
    } else {
      orphans.push(iv);
    }
  }

  let interviewsConfirmed = 0;
  let interviewsCompleted = 0;
  const interviewsConfirmedContrib: ContributorItem[] = [];
  const interviewsCompletedContrib: ContributorItem[] = [];

  function scoreInterviewGroup(ivs: InterviewForScoring[]): void {
    let groupConfirmed = false;
    let groupCompleted = false;
    const confirmContribs: ContributorItem[] = [];
    const completeContribs: ContributorItem[] = [];
    for (const iv of ivs) {
      // Confirm fires when the doc's `_perfConfirmedAt` falls in the window.
      // Legacy fallback: any client interview whose current status is
      // Confirm or Completed (Complete implies prior Confirm) with
      // `createdAt` in the window — covers pre-migration docs that the
      // backfill missed.
      const confirmEvent =
        inWindow(iv._perfConfirmedAt, from, to) ||
        (!iv._perfConfirmedAt &&
          (iv.interviewStatus === CONFIRMED_STATUS ||
            iv.interviewStatus === COMPLETED_STATUS) &&
          inWindow(iv.createdAt, from, to));
      if (confirmEvent) {
        groupConfirmed = true;
        confirmContribs.push({
          type: "interview",
          reqID: iv.reqID,
          intId: iv.intId,
        });
      }

      const completeEvent =
        inWindow(iv._perfCompletedAt, from, to) ||
        (!iv._perfCompletedAt &&
          iv.interviewStatus === COMPLETED_STATUS &&
          inWindow(iv.createdAt, from, to));
      if (completeEvent) {
        groupCompleted = true;
        completeContribs.push({
          type: "interview",
          reqID: iv.reqID,
          intId: iv.intId,
        });
      }
    }
    if (groupConfirmed) {
      interviewsConfirmed++;
      // Per-req cap of 1: keep only one contributor entry per group for the
      // breakdown drawer, otherwise the UI shows N intIds for a single +3.
      if (confirmContribs.length > 0) {
        interviewsConfirmedContrib.push(confirmContribs[0]);
      }
    }
    if (groupCompleted) {
      interviewsCompleted++;
      if (completeContribs.length > 0) {
        interviewsCompletedContrib.push(completeContribs[0]);
      }
    }
  }

  for (const ivs of interviewsByReq.values()) scoreInterviewGroup(ivs);
  // Orphans are scored individually — no req to dedupe against.
  for (const iv of orphans) scoreInterviewGroup([iv]);

  // ── Stale-confirmed penalty: count interviews where the cron stamped
  // `_perfStaleConfirmFiredAt` in the window. The stamp is set-once, so a
  // confirm that goes stale in May and is later completed in June still
  // contributes a penalty to May's leaderboard.
  let staleConfirmedInterviews = 0;
  const staleConfirmedContrib: ContributorItem[] = [];
  for (const iv of args.interviews) {
    if (iv.interviewWith !== CLIENT_INTERVIEW_WITH) continue;
    if (inWindow(iv._perfStaleConfirmFiredAt, from, to)) {
      staleConfirmedInterviews++;
      staleConfirmedContrib.push({
        type: "interview",
        reqID: iv.reqID,
        intId: iv.intId,
      });
    }
  }

  const totalInterviews = interviewsConfirmed + interviewsCompleted;
  const conversionPct = round2(
    (totalInterviews / Math.max(submissions, 1)) * 100,
  );

  return {
    metrics: {
      submissions,
      interviewsConfirmed,
      interviewsCompleted,
      staleConfirmedInterviews,
      staleSubmissions,
      unworkedRequirements,
      conversionPct,
    },
    contributors: {
      submissions: submissionsContrib,
      interviewsConfirmed: interviewsConfirmedContrib,
      interviewsCompleted: interviewsCompletedContrib,
      staleConfirmedInterviews: staleConfirmedContrib,
      staleSubmissions: staleSubmissionsContrib,
      unworkedRequirements: unworkedRequirementsContrib,
    },
  };
}

export function scoreMarketing(
  m: MarketingMetrics,
  weights: Record<string, number>
): ScoreResult {
  const w = (k: string, d = 0) => (Number.isFinite(weights[k]) ? weights[k] : d);

  const lines: ScoreLine[] = [
    {
      key: "submissions",
      label: "Submissions",
      count: m.submissions,
      weight: w("SUBMISSION_WEIGHT"),
      points: round2(m.submissions * w("SUBMISSION_WEIGHT")),
      kind: "positive",
    },
    {
      key: "interviewsConfirmed",
      label: "Client interviews confirmed",
      count: m.interviewsConfirmed,
      weight: w("INTERVIEW_CONFIRM_WEIGHT"),
      points: round2(m.interviewsConfirmed * w("INTERVIEW_CONFIRM_WEIGHT")),
      kind: "positive",
    },
    {
      key: "interviewsCompleted",
      label: "Client interviews completed",
      count: m.interviewsCompleted,
      weight: w("INTERVIEW_COMPLETED_WEIGHT"),
      points: round2(m.interviewsCompleted * w("INTERVIEW_COMPLETED_WEIGHT")),
      kind: "positive",
    },
    {
      key: "conversionPct",
      label: "Conversion bonus",
      count: m.conversionPct,
      weight: w("CONVERSION_BONUS"),
      points: round2(m.conversionPct * w("CONVERSION_BONUS")),
      kind: "positive",
    },
    {
      key: "staleConfirmedInterviews",
      label: "Stale confirmed interviews penalty",
      count: m.staleConfirmedInterviews,
      weight: w("STALE_CONFIRM_PENALTY"),
      points: round2(
        -m.staleConfirmedInterviews * w("STALE_CONFIRM_PENALTY"),
      ),
      kind: "penalty",
    },
    {
      key: "staleSubmissions",
      label: "Stale submissions penalty",
      count: m.staleSubmissions,
      weight: w("STALE_SUBMISSION_PENALTY"),
      points: round2(-m.staleSubmissions * w("STALE_SUBMISSION_PENALTY")),
      kind: "penalty",
    },
    {
      key: "unworkedRequirements",
      label: "Unworked requirements penalty",
      count: m.unworkedRequirements,
      weight: w("UNWORKED_REQ_PENALTY"),
      points: round2(-m.unworkedRequirements * w("UNWORKED_REQ_PENALTY")),
      kind: "penalty",
    },
  ];

  const rawTotal = round2(lines.reduce((s, l) => s + l.points, 0));
  return { score: Math.max(0, rawTotal), rawTotal, breakdown: lines };
}

// ── Support ──────────────────────────────────────────────────────────────

/** Support gets stage-weighted credit when any child of a parent reaches
 *  these statuses. `Project Active` / `Project Inactive` are the "shipped"
 *  states — the highest-weight tier for support scoring. */
const PROJECT_STAGE_STATUSES = new Set(["Project Active", "Project Inactive"]);

export interface SupportMetrics {
  requirementsEntered: number;
  entriesReachedSubmitted: number;
  entriesReachedInterviewed: number;
  /** Parent credited if any child (or self, legacy) reached a Project stage. */
  entriesReachedProject: number;
  unprogressedEntries: number;
  duplicatesEntered: number;
}

/**
 * Helpers — pick the most relevant timestamp for a milestone from either
 * the parent or any of its children, with a legacy fallback. Returns the
 * earliest stamp that's in-window, or undefined if nothing qualifies.
 */
function anyInWindow(
  candidates: Array<Date | string | undefined>,
  from: Date,
  to: Date,
): boolean {
  for (const c of candidates) {
    if (inWindow(c, from, to)) return true;
  }
  return false;
}

export function computeSupportMetrics(args: {
  /**
   * ALL requirements entered by this user — including duplicates AND child
   * assignments. The function partitions internally:
   *   - duplicates are counted as penalties, excluded from positives
   *   - children are skipped for positive counts; their status timestamps
   *     roll up to the parent ("parent credited if ANY child reached the
   *     milestone in this window").
   *
   * Unlike the marketing fetch, no date filter is applied upstream — the
   * function uses `createdAt ∈ window` for "entered" and `_perf*At ∈ window`
   * for each milestone, so callers should pass all reqs ever entered by
   * the user (the controller still scopes by `reqEnteredByRef`).
   */
  enteredReqs: ReqForScoring[];
  /**
   * Optional gate for "reached Interviewed" credit — only count the parent
   * if the parent or any of its children has at least one client-facing
   * interview on record. When omitted, the function falls back to the
   * timestamp-only rollup.
   */
  clientInterviewReqIDs?: Set<string>;
  from: Date;
  to: Date;
}): { metrics: SupportMetrics; contributors: Contributors } {
  const { from, to } = args;

  let requirementsEntered = 0;
  let entriesReachedSubmitted = 0;
  let entriesReachedInterviewed = 0;
  let entriesReachedProject = 0;
  let unprogressedEntries = 0;
  let duplicatesEntered = 0;
  const requirementsEnteredContrib: ContributorItem[] = [];
  const entriesReachedSubmittedContrib: ContributorItem[] = [];
  const entriesReachedInterviewedContrib: ContributorItem[] = [];
  const entriesReachedProjectContrib: ContributorItem[] = [];
  const unprogressedEntriesContrib: ContributorItem[] = [];
  const duplicatesEnteredContrib: ContributorItem[] = [];

  // Partition parents vs children so we can roll up child timestamps onto
  // the parent for milestone-reached events. Children inherit
  // `reqEnteredByRef` from their parent on creation, so they show up in
  // this list — but must not be credited as independent support entries.
  const parents: ReqForScoring[] = [];
  const childrenByParent = new Map<string, ReqForScoring[]>();
  for (const r of args.enteredReqs) {
    if (r.parentReqID) {
      const arr = childrenByParent.get(r.parentReqID) || [];
      arr.push(r);
      childrenByParent.set(r.parentReqID, arr);
    } else {
      parents.push(r);
    }
  }

  for (const r of parents) {
    if (r.isDuplicate === "yes") {
      // Duplicates: penalty counted in the period the duplicate was
      // entered (`createdAt ∈ window`). No timestamp needed — the
      // `isDuplicate` flag is the permanent record.
      if (inWindow(r.createdAt, from, to)) {
        duplicatesEntered++;
        if (r.reqID)
          duplicatesEnteredContrib.push({ type: "requirement", reqID: r.reqID });
      }
      continue;
    }

    // Requirements entered = req created in window.
    if (inWindow(r.createdAt, from, to)) {
      requirementsEntered++;
      if (r.reqID)
        requirementsEnteredContrib.push({ type: "requirement", reqID: r.reqID });
    }

    const children = (r.reqID && childrenByParent.get(r.reqID)) || [];
    const childSubmittedAts = children.map((c) => c._perfSubmittedAt);
    const childInterviewedAts = children.map((c) => c._perfInterviewedAt);
    const childProjectAts: Array<Date | string | undefined> = [];
    for (const c of children) {
      childProjectAts.push(c._perfProjectActiveAt);
      childProjectAts.push(c._perfProjectInactiveAt);
    }

    // Parent credits "reached Submitted" if parent OR any child has
    // `_perfSubmittedAt` in the window. Legacy fallback retained:
    // status-based check + createdAt window for un-backfilled docs.
    const submittedCandidates: Array<Date | string | undefined> = [
      r._perfSubmittedAt,
      ...childSubmittedAts,
    ];
    const legacySubmitted =
      !r._perfSubmittedAt &&
      children.every((c) => !c._perfSubmittedAt) &&
      (SUBMITTED_OR_BEYOND.has(r.reqStatus || "") ||
        children.some((c) => SUBMITTED_OR_BEYOND.has(c.reqStatus || ""))) &&
      inWindow(r.createdAt, from, to);
    if (anyInWindow(submittedCandidates, from, to) || legacySubmitted) {
      entriesReachedSubmitted++;
      if (r.reqID)
        entriesReachedSubmittedContrib.push({
          type: "requirement",
          reqID: r.reqID,
        });
    }

    // Reached Interviewed — gated by client-interview presence if the
    // caller supplied the set.
    const interviewedCandidates: Array<Date | string | undefined> = [
      r._perfInterviewedAt,
      ...childInterviewedAts,
    ];
    if (anyInWindow(interviewedCandidates, from, to)) {
      const gate = args.clientInterviewReqIDs;
      const passesClientGate =
        !gate ||
        (r.reqID && gate.has(r.reqID)) ||
        children.some((c) => c.reqID && gate.has(c.reqID));
      if (passesClientGate) {
        entriesReachedInterviewed++;
        if (r.reqID)
          entriesReachedInterviewedContrib.push({
            type: "requirement",
            reqID: r.reqID,
          });
      }
    }

    // Reached Project stage — Active OR Inactive (both count). Stamps on
    // either parent or any child are accepted.
    if (
      anyInWindow(
        [r._perfProjectActiveAt, r._perfProjectInactiveAt, ...childProjectAts],
        from,
        to,
      )
    ) {
      entriesReachedProject++;
      if (r.reqID)
        entriesReachedProjectContrib.push({
          type: "requirement",
          reqID: r.reqID,
        });
    }

    // Unprogressed penalty: count if cron stamped `_perfUnprogressedPenaltyFiredAt`
    // in the window. Survives later remediation.
    if (
      children.length === 0 &&
      inWindow(r._perfUnprogressedPenaltyFiredAt, from, to)
    ) {
      unprogressedEntries++;
      if (r.reqID)
        unprogressedEntriesContrib.push({
          type: "requirement",
          reqID: r.reqID,
        });
    }
  }

  return {
    metrics: {
      requirementsEntered,
      entriesReachedSubmitted,
      entriesReachedInterviewed,
      entriesReachedProject,
      unprogressedEntries,
      duplicatesEntered,
    },
    contributors: {
      requirementsEntered: requirementsEnteredContrib,
      entriesReachedSubmitted: entriesReachedSubmittedContrib,
      entriesReachedInterviewed: entriesReachedInterviewedContrib,
      entriesReachedProject: entriesReachedProjectContrib,
      unprogressedEntries: unprogressedEntriesContrib,
      duplicatesEntered: duplicatesEnteredContrib,
    },
  };
}

export function scoreSupport(
  m: SupportMetrics,
  weights: Record<string, number>
): ScoreResult {
  const w = (k: string, d = 0) => (Number.isFinite(weights[k]) ? weights[k] : d);

  const lines: ScoreLine[] = [
    {
      key: "requirementsEntered",
      label: "Requirements entered",
      count: m.requirementsEntered,
      weight: w("REQ_ENTRY_WEIGHT"),
      points: round2(m.requirementsEntered * w("REQ_ENTRY_WEIGHT")),
      kind: "positive",
    },
    {
      key: "entriesReachedSubmitted",
      label: "Entries that reached Submitted",
      count: m.entriesReachedSubmitted,
      weight: w("REQ_SUBMITTED_WEIGHT"),
      points: round2(m.entriesReachedSubmitted * w("REQ_SUBMITTED_WEIGHT")),
      kind: "positive",
    },
    {
      key: "entriesReachedInterviewed",
      label: "Entries that reached Interviewed",
      count: m.entriesReachedInterviewed,
      weight: w("REQ_INTERVIEWED_WEIGHT"),
      points: round2(m.entriesReachedInterviewed * w("REQ_INTERVIEWED_WEIGHT")),
      kind: "positive",
    },
    {
      key: "entriesReachedProject",
      label: "Entries that reached Project stage",
      count: m.entriesReachedProject,
      weight: w("REQ_PROJECT_WEIGHT"),
      points: round2(m.entriesReachedProject * w("REQ_PROJECT_WEIGHT")),
      kind: "positive",
    },
    {
      key: "unprogressedEntries",
      label: "Unprogressed entries penalty",
      count: m.unprogressedEntries,
      weight: w("UNPROGRESSED_REQ_PENALTY"),
      points: round2(-m.unprogressedEntries * w("UNPROGRESSED_REQ_PENALTY")),
      kind: "penalty",
    },
    {
      key: "duplicatesEntered",
      label: "Duplicates entered penalty",
      count: m.duplicatesEntered,
      weight: w("DUPLICATE_PENALTY"),
      points: round2(-m.duplicatesEntered * w("DUPLICATE_PENALTY")),
      kind: "penalty",
    },
  ];

  const rawTotal = round2(lines.reduce((s, l) => s + l.points, 0));
  return { score: Math.max(0, rawTotal), rawTotal, breakdown: lines };
}
