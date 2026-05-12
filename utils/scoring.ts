/**
 * Pure scoring math for Marketing + Support performance.
 *
 * Everything here is side-effect-free and Mongoose-free so the controller can
 * fetch data once, hand plain objects to these functions, and stay easy to
 * test. Each scored metric carries a `label` and `points` so the UI can show
 * the breakdown line-by-line without recomputing.
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

// ── Marketing ────────────────────────────────────────────────────────────

export interface MarketingMetrics {
  submissions: number;
  /** Currently in "Interview Confirm" — partial credit, not the finish line. */
  interviewsConfirmed: number;
  /** Reached "Interview Completed" — full credit. */
  interviewsCompleted: number;
  /**
   * Confirmed interview whose scheduled date passed by more than the
   * `staleConfirmedDays` threshold and still sits in "Interview Confirm".
   * Signals a reschedule / client-no-show / dropped deal. Counted as a
   * penalty on top of the (smaller) confirm credit so the net reward for
   * an un-completed interview stays modest.
   */
  staleConfirmedInterviews: number;
  staleSubmissions: number;
  unworkedRequirements: number;
  /** (confirmed + completed) / max(submissions,1) × 100 — client-only. */
  conversionPct: number;
}

/**
 * Requirement shape the function needs — keep it permissive so the caller
 * can pass lean docs from either the live or archive collection.
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
}

export interface InterviewForScoring {
  _id?: unknown;
  intId?: string;
  reqID?: string;
  marketingPersonRef?: unknown;
  interviewStatus?: string;
  /** Only "Client" interviews count toward marketing + support performance. */
  interviewWith?: string;
  /** Scheduled interview date — used to detect stale-confirmed. */
  interviewDate?: Date | string;
  createdAt?: Date | string;
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

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}

/** Score a marketing user from their assigned requirements + interviews. */
export function computeMarketingMetrics(args: {
  assignedReqs: ReqForScoring[];
  interviews: InterviewForScoring[];
  now?: Date;
  staleSubmissionDays: number;
  unworkedReqDays: number;
  /** Days past `interviewDate` before a still-"Interview Confirm" row is
   *  treated as a wasted (reschedule / no-show / denied) interview. */
  staleConfirmedDays: number;
}): { metrics: MarketingMetrics; contributors: Contributors } {
  const now = args.now ?? new Date();
  let submissions = 0;
  let staleSubmissions = 0;
  let unworkedRequirements = 0;
  const submissionsContrib: ContributorItem[] = [];
  const staleSubmissionsContrib: ContributorItem[] = [];
  const unworkedRequirementsContrib: ContributorItem[] = [];

  for (const r of args.assignedReqs) {
    const status = r.reqStatus || "";
    if (SUBMITTED_OR_BEYOND.has(status)) {
      submissions++;
      if (r.reqID) submissionsContrib.push({ type: "requirement", reqID: r.reqID });
    }

    const updated = r.updatedAt ? new Date(r.updatedAt) : null;
    if (!updated) continue;
    const ageDays = daysBetween(now, updated);

    if (status === "Submitted" && ageDays > args.staleSubmissionDays) {
      staleSubmissions++;
      if (r.reqID) staleSubmissionsContrib.push({ type: "requirement", reqID: r.reqID });
    }
    if (status === "New Working" && ageDays > args.unworkedReqDays) {
      unworkedRequirements++;
      if (r.reqID) unworkedRequirementsContrib.push({ type: "requirement", reqID: r.reqID });
    }
  }

  // A requirement contributes AT MOST ONE count to the leaderboard regardless
  // of how many client interviews it had. Group this marketer's client-only
  // interviews by reqID, then classify each group:
  //   - Completed wins over Confirm (best-status-wins).
  //   - Stale-confirm penalty fires only when the group's best status is
  //     Confirm; a req that converted to Completed isn't a wasted req even
  //     if it had an earlier stale Confirm sibling.
  // Interviews without a reqID are classified individually so legacy data
  // still counts.
  const clientByReq = new Map<string, InterviewForScoring[]>();
  const orphanGroups: InterviewForScoring[][] = [];
  for (const iv of args.interviews) {
    if (iv.interviewWith !== CLIENT_INTERVIEW_WITH) continue;
    if (iv.reqID) {
      const arr = clientByReq.get(iv.reqID) || [];
      arr.push(iv);
      clientByReq.set(iv.reqID, arr);
    } else {
      orphanGroups.push([iv]);
    }
  }

  let interviewsConfirmed = 0;
  let interviewsCompleted = 0;
  let staleConfirmedInterviews = 0;
  const interviewsConfirmedContrib: ContributorItem[] = [];
  const interviewsCompletedContrib: ContributorItem[] = [];
  const staleConfirmedContrib: ContributorItem[] = [];

  const allGroups = [...clientByReq.values(), ...orphanGroups];
  for (const ivs of allGroups) {
    let hasCompleted = false;
    let hasConfirm = false;
    let hasStaleConfirm = false;
    const completedIvs: InterviewForScoring[] = [];
    const confirmIvs: InterviewForScoring[] = [];
    const staleConfirmIvs: InterviewForScoring[] = [];
    for (const iv of ivs) {
      const status = iv.interviewStatus || "";
      if (status === COMPLETED_STATUS) {
        hasCompleted = true;
        completedIvs.push(iv);
      } else if (status === CONFIRMED_STATUS) {
        hasConfirm = true;
        confirmIvs.push(iv);
        if (iv.interviewDate) {
          const iDate = new Date(iv.interviewDate);
          if (
            !Number.isNaN(iDate.getTime()) &&
            daysBetween(now, iDate) > args.staleConfirmedDays
          ) {
            hasStaleConfirm = true;
            staleConfirmIvs.push(iv);
          }
        }
      }
    }
    if (hasCompleted) {
      interviewsCompleted++;
      for (const iv of completedIvs) {
        interviewsCompletedContrib.push({
          type: "interview",
          reqID: iv.reqID,
          intId: iv.intId,
        });
      }
    } else if (hasConfirm) {
      interviewsConfirmed++;
      for (const iv of confirmIvs) {
        interviewsConfirmedContrib.push({
          type: "interview",
          reqID: iv.reqID,
          intId: iv.intId,
        });
      }
      if (hasStaleConfirm) {
        staleConfirmedInterviews++;
        for (const iv of staleConfirmIvs) {
          staleConfirmedContrib.push({
            type: "interview",
            reqID: iv.reqID,
            intId: iv.intId,
          });
        }
      }
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

export function computeSupportMetrics(args: {
  /**
   * ALL requirements entered by this user in the period, including duplicates
   * AND child assignments. The function partitions internally:
   *   - duplicates are counted as penalties, excluded from positives
   *   - children are skipped for positive counts; their status rolls up to
   *     the parent (`parent credited if ANY child reached the milestone`).
   */
  enteredReqs: ReqForScoring[];
  /**
   * Optional gate for "reached Interviewed" credit — only count the parent
   * if the parent or any of its children has at least one client-facing
   * interview on record. When omitted, the function falls back to the
   * legacy status-only rollup for backward compatibility.
   */
  clientInterviewReqIDs?: Set<string>;
  now?: Date;
  unprogressedReqDays: number;
}): { metrics: SupportMetrics; contributors: Contributors } {
  const now = args.now ?? new Date();
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

  // Partition parents vs children so we can roll up child statuses onto the
  // parent. Children inherit reqEnteredByRef from their parent on creation,
  // so they show up in this list — but must not be credited as independent
  // support entries.
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
      duplicatesEntered++;
      if (r.reqID) duplicatesEnteredContrib.push({ type: "requirement", reqID: r.reqID });
      continue; // excluded from positives, same as existing reports.
    }
    requirementsEntered++;
    if (r.reqID) requirementsEnteredContrib.push({ type: "requirement", reqID: r.reqID });
    const parentStatus = r.reqStatus || "";
    const children = (r.reqID && childrenByParent.get(r.reqID)) || [];

    // Parent credits Submitted / Interviewed if the parent itself reached it
    // (legacy single-assign) OR any child reached it (multi-assign rollup).
    const anyChildStatus = (set: Set<string>) =>
      children.some((c) => set.has(c.reqStatus || ""));

    if (SUBMITTED_OR_BEYOND.has(parentStatus) || anyChildStatus(SUBMITTED_OR_BEYOND)) {
      entriesReachedSubmitted++;
      if (r.reqID) entriesReachedSubmittedContrib.push({ type: "requirement", reqID: r.reqID });
    }
    if (
      INTERVIEWED_OR_BEYOND.has(parentStatus) ||
      anyChildStatus(INTERVIEWED_OR_BEYOND)
    ) {
      // Optional client-interview gate: when the caller supplies the set of
      // reqIDs that have a client-facing interview, require parent-or-any-
      // child to be in it. Vendor-only or missing-interview progressions
      // don't count as a real "reached Interviewed" milestone.
      const gate = args.clientInterviewReqIDs;
      const passesClientGate =
        !gate ||
        (r.reqID && gate.has(r.reqID)) ||
        children.some((c) => c.reqID && gate.has(c.reqID));
      if (passesClientGate) {
        entriesReachedInterviewed++;
        if (r.reqID) entriesReachedInterviewedContrib.push({ type: "requirement", reqID: r.reqID });
      }
    }
    if (
      PROJECT_STAGE_STATUSES.has(parentStatus) ||
      anyChildStatus(PROJECT_STAGE_STATUSES)
    ) {
      entriesReachedProject++;
      if (r.reqID) entriesReachedProjectContrib.push({ type: "requirement", reqID: r.reqID });
    }

    // Unprogressed penalty: parent is "still stuck" only when it has no
    // child assignments AND its own status is still New Working past the
    // threshold. A parent with any child assignment has been acted on.
    if (children.length === 0 && parentStatus === "New Working") {
      const updated = r.updatedAt ? new Date(r.updatedAt) : null;
      if (updated && daysBetween(now, updated) > args.unprogressedReqDays) {
        unprogressedEntries++;
        if (r.reqID) unprogressedEntriesContrib.push({ type: "requirement", reqID: r.reqID });
      }
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
