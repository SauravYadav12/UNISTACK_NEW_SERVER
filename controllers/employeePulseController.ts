/**
 * Employee Pulse — controller.
 *
 * Single GET endpoint that returns the entire bundle for the page: KPIs,
 * metrics grid, position trend, and the Proactivity Board.
 *
 * Auth: SuperAdmin by default; other roles can be granted via the
 * client's Access Control page. This controller trusts the JWT + the
 * client-side ACL gate; server-side we accept any authenticated user
 * whose JWT is valid — the sensitive scoping is that userIds must be
 * an explicit input, so a hostile client can't dump everyone's data
 * without picking specific employees (still, we hard-cap at 4).
 */
import { Request, Response } from "express";
import { UserModel } from "../models/userModel";
import {
  buildEmployeePulseBundle,
  PulseBucket,
  PulseGroupBy,
  PulseMetric,
  PulseReqFilter,
} from "../services/employeeActivityService";
import { myDate } from "../utils/dateUtil";
import { getErrorMessage } from "../utils/utils";

const ALLOWED_GROUP_BY: PulseGroupBy[] = [
  "jobTitle",
  "primaryTech",
  "secondaryTech",
  "primaryTechStack",
  "clientCompany",
  "employementType",
  "taxType",
  "remote",
];
const ALLOWED_BUCKETS: PulseBucket[] = ["day", "week", "biweek", "month"];
const ALLOWED_METRICS: PulseMetric[] = [
  "submissions",
  "interviewsCompleted",
  "offers",
  "score",
];

function pickReqFilter(q: Record<string, unknown>): PulseReqFilter {
  const s = (k: string): string | undefined => {
    const v = q[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    return undefined;
  };
  const arr = (k: string): string[] | undefined => {
    const v = q[k];
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
    if (typeof v === "string" && v.trim())
      return v.split(",").map((x) => x.trim()).filter(Boolean);
    return undefined;
  };
  const num = (k: string): number | undefined => {
    const v = q[k];
    if (typeof v === "string" && v.trim() && !Number.isNaN(Number(v)))
      return Number(v);
    if (typeof v === "number") return v;
    return undefined;
  };
  return {
    reqStatus: arr("reqStatus"),
    assignedToRef: s("assignedToRef"),
    reqEnteredByRef: s("reqEnteredByRef"),
    appliedForRef: s("appliedForRef"),
    recordOwner: s("recordOwner"),
    starColor: arr("starColor"),
    isDuplicate: s("isDuplicate"),
    jobTitle: s("jobTitle"),
    employementType: arr("employementType"),
    primaryTech: s("primaryTech"),
    secondaryTech: s("secondaryTech"),
    primaryTechStack: s("primaryTechStack"),
    gotOnResume: s("gotOnResume"),
    rateMin: num("rateMin"),
    rateMax: num("rateMax"),
    taxType: arr("taxType"),
    remote: arr("remote"),
    duration: arr("duration"),
    clientCompany: s("clientCompany"),
    clientPerson: s("clientPerson"),
    clientEmail: s("clientEmail"),
    clientPhone: s("clientPhone"),
    clientWebsite: s("clientWebsite"),
    clientAddress: s("clientAddress"),
    primeVendorCompany: s("primeVendorCompany"),
    primeVendorName: s("primeVendorName"),
    primeVendorEmail: s("primeVendorEmail"),
    primeVendorPhone: s("primeVendorPhone"),
    primeVendorWebsite: s("primeVendorWebsite"),
    vendorCompany: s("vendorCompany"),
    vendorPersonName: s("vendorPersonName"),
    vendorEmail: s("vendorEmail"),
    vendorPhone: s("vendorPhone"),
    vendorWebsite: s("vendorWebsite"),
    gotReqFrom: s("gotReqFrom"),
    jobPortalLink: s("jobPortalLink"),
    parentReqID: s("parentReqID"),
    childSuffix: s("childSuffix"),
    reqEnteredFrom: s("reqEnteredFrom"),
    reqEnteredTo: s("reqEnteredTo"),
  };
}

export const getEmployeePulse = async (req: Request, res: Response) => {
  try {
    const q = req.query as Record<string, unknown>;

    // userIds (comma-separated, capped at 4)
    const raw = typeof q.userIds === "string" ? (q.userIds as string) : "";
    const userIds = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4);

    // Date window — same handling as the leaderboard so date-preset chips
    // are reusable between pages.
    const { from, to } = myDate(
      typeof q.fromDate === "string" ? q.fromDate : undefined,
      typeof q.toDate === "string" ? q.toDate : undefined,
    );

    const groupBy = ALLOWED_GROUP_BY.includes(q.groupBy as PulseGroupBy)
      ? (q.groupBy as PulseGroupBy)
      : "jobTitle";
    const bucket = ALLOWED_BUCKETS.includes(q.bucket as PulseBucket)
      ? (q.bucket as PulseBucket)
      : "day";
    const metric = ALLOWED_METRICS.includes(q.metric as PulseMetric)
      ? (q.metric as PulseMetric)
      : "submissions";

    const reqFilter = pickReqFilter(q);

    const bundle = await buildEmployeePulseBundle({
      userIds,
      from,
      to,
      reqFilter,
      groupBy,
      bucket,
      metric,
    });

    // Resolve real names for the trend's per-employee overlay (the service
    // returned uids as placeholders).
    if (bundle.trend.perEmployeeOverlay?.length) {
      const uidToName = new Map(
        bundle.users.map((u) => [u.userId, u.name] as const),
      );
      for (const ov of bundle.trend.perEmployeeOverlay) {
        ov.name = uidToName.get(ov.userId) || ov.userId;
      }
    }

    res.status(200).json({
      status: "success",
      data: {
        window: { from, to },
        ...bundle,
      },
    });
  } catch (error) {
    console.error("employeePulse error:", error);
    res
      .status(500)
      .json({ status: "failed", error: getErrorMessage(error) });
  }
};

/** GET /employee-pulse/employees — lightweight list of pickable employees
 *  (name + role) so the client autocomplete doesn't have to load the full
 *  User model. */
export const listPulseEmployees = async (_req: Request, res: Response) => {
  try {
    const users = await UserModel.find({ active: true })
      .select("firstName lastName email role")
      .sort({ firstName: 1 })
      .lean();
    const rows = users.map((u) => ({
      userId: String(u._id),
      name: `${u.firstName || ""} ${u.lastName || ""}`.trim() || u.email,
      email: u.email,
      role: u.role || [],
    }));
    res.status(200).json({ status: "success", data: rows });
  } catch (error) {
    res.status(500).json({ status: "failed", error: getErrorMessage(error) });
  }
};
