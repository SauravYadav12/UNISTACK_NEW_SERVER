import { Request, Response } from "express";
import { paginationInstance } from "../utils/pagination";
import { LeaveModel, LeaveStatus, LeavePaymentCategory } from "../models/leaveModel";
import { ILeave, IUser, UserDoc } from "../interface";
import { UserRole } from "../enums/UserEnum";
import { getLeaveRequestTemplate, getLeaveStatusTemplate } from "../templates";
import { sendMail } from "../utils/mailTransporter";
import { UserModel } from "../models/userModel";
import { MailOptions } from "nodemailer/lib/sendmail-transport";
import moment from "moment";
import { AttendanceStatus } from "../models/attendance";
import { handleMarkAttendance } from "./attendanceController";
import ENV_VARS from "../config/env.config";
import { mailSenders } from "../utils/mailSenders";
import { emitNotification } from "../services/notificationService";
import {
  getBalance,
  incrementUsed,
  decrementUsed,
  computeLeaveSplit,
} from "../services/leaveBalanceService";
import {
  getLeaveTypeById,
  getUnpaidBucketType,
} from "./leaveTypeController";
import { FilterQuery, Types } from "mongoose";
import { UserProfileModel } from "../models/userProfileModel";
import { LeaveTypeModel } from "../models/leaveTypeModel";
import { isOnProbation, probationEndDate } from "../utils/probation";

function requestedDays(leave: { startDate: string; endDate: string; isHalfDay?: boolean }): number {
  const start = moment(leave.startDate, "YYYY/MM/DD");
  const end = moment(leave.endDate, "YYYY/MM/DD");
  const inclusive = end.diff(start, "days") + 1;
  const days = Math.max(inclusive, 1);
  return leave.isHalfDay ? days * 0.5 : days;
}

function getEmailSubject(user: IUser | UserDoc) {
  const fullname =
    ((user.firstName || "") + " " + (user.lastName || "")).trim() || user.email;
  return "Leave Request from " + fullname;
}

// Default recipient list for leave-request notifications. Env var
// LEAVE_NOTIFY_EMAILS (comma-separated) overrides — and COMPANY_EMAIL is
// appended if set and not already in the list, so HR keeps a copy.
const DEFAULT_LEAVE_NOTIFY_EMAILS = [
  "info@unicodez.com",
  "hr@unicodez.com",
  "sam@unicodez.com",
];

function leaveNotifyRecipients(): string[] {
  const base = ENV_VARS.LEAVE_NOTIFY_EMAILS?.length
    ? ENV_VARS.LEAVE_NOTIFY_EMAILS
    : DEFAULT_LEAVE_NOTIFY_EMAILS;
  const set = new Set(base);
  if (ENV_VARS.COMPANY_EMAIL) set.add(ENV_VARS.COMPANY_EMAIL);
  return [...set];
}

export const getLeaves = async (req: Request, res: Response) => {
  try {
    const { options, instance } = await paginationInstance(
      req.query,
      LeaveModel,
    );
    const { startIndex, query, limit } = options;

    // Authorisation model for the leaves list:
    //   - Regular employee → can only ever see their OWN leaves. We
    //     overwrite `userRef` with their authenticated user id so
    //     omitting the query-param can't be used to escalate.
    //   - Admin / super-admin → can see everyone. Apply the visibility
    //     mask (hide super-admin role + inactive employees) UNLESS the
    //     caller pinned a specific `userRef` (then their filter wins).
    //
    // This closes two bugs at once:
    //   (a) The old code spread `query` then set `userRef: { $nin: ... }`,
    //       overwriting an employee's "show my own" filter and exposing
    //       everyone's history.
    //   (b) Even with (a) fixed, an employee could omit `userRef` and
    //       still see the unfiltered list. Now the server forces it.
    const caller = req.user as UserDoc | undefined;
    const callerRoles = caller?.role || [];
    const isAdmin =
      callerRoles.includes(UserRole.Admin) ||
      callerRoles.includes(UserRole.SuperAdmin);

    // Pass `caller._id` (a Mongoose ObjectId) DIRECTLY into the query
    // rather than `.toString()` it first. Lossless — both `equals()`
    // and Mongoose auto-cast work with the ObjectId; the string form
    // relies on Mongoose casting via the schema path, which has
    // failed to match in some edge cases on this codebase.
    const callerId = caller?._id;

    let filteredQuery: Record<string, unknown>;
    if (!isAdmin) {
      // Regular employee — pin to self, no exceptions. If the JWT
      // somehow lacks a usable user id, bail out 401 rather than
      // silently broadening the query.
      if (!callerId) {
        res.status(401).json({ error: "Unauthenticated." });
        return;
      }
      filteredQuery = {
        ...query,
        userRef: callerId,
      };
    } else if (query.userRef !== undefined && query.userRef !== null) {
      // Admin asked for a specific employee — honour it.
      filteredQuery = query;
    } else {
      // Admin asked for everyone — apply visibility mask.
      const hiddenUserIds = await UserModel.distinct("_id", {
        $or: [{ role: UserRole.SuperAdmin }, { active: false }],
      });
      filteredQuery = {
        ...query,
        userRef: { $nin: hiddenUserIds },
      };
    }

    const totalDocuments = await LeaveModel.countDocuments(filteredQuery);
    const totalPages = Math.ceil(totalDocuments / limit);
    const adjustedInstance = {
      ...instance,
      totalDocuments,
      totalPages,
      next:
        startIndex + limit < totalDocuments
          ? { page: (instance.currentPage || 1) + 1, limit }
          : undefined,
    };

    const leaves = await LeaveModel.find(filteredQuery)
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(startIndex)
      .exec();
    const data = { ...adjustedInstance, results: leaves };

    res.status(200).json({ data });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

export const getLeaveById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const leave = await LeaveModel.findById(id).exec();
    res.status(200).json({ data: leave });
  } catch (error) {
    console.error("Error in getLeaveById: ", error);
    res.status(500).json({ error: error });
  }
};

function validateDateOrder(body: Record<string, unknown>): string | null {
  const s = body.startDate as string | undefined;
  const e = body.endDate as string | undefined;
  if (!s || !e) return null;
  if (moment(e, "YYYY/MM/DD").isBefore(moment(s, "YYYY/MM/DD"))) {
    return "End date must be on or after start date";
  }
  return null;
}

/**
 * GET /leaves/me/probation
 *
 * Returns the calling user's probation snapshot. React reads this from
 * the leave-request form to filter the type picker (probationary
 * employees only see UL) and to show a banner explaining the rule.
 *
 * Shape is intentionally small so it's cheap to poll on form mount:
 *   { onProbation: boolean, probationEnd?: ISO date, dateOfJoining?: ISO }
 */
export const getMyProbationStatus = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const profileFilter = { user: user._id } as FilterQuery<
      Record<string, unknown>
    >;
    const profile = await UserProfileModel.findOne(profileFilter)
      .select(
        "dateOfJoining probationStatus probationOriginalEndDate probationEndDate",
      )
      .lean();
    const p = profile as {
      dateOfJoining?: Date;
      probationStatus?: "in_progress" | "confirmed";
      probationOriginalEndDate?: Date;
      probationEndDate?: Date;
    } | null;
    const doj = p?.dateOfJoining;
    // New rule: probation is explicit (status field). Falls back to the
    // legacy derived check only when status hasn't been stamped yet
    // (briefly during migration; new joiners always have it).
    const onProbation =
      p?.probationStatus === "in_progress" ||
      (!p?.probationStatus && isOnProbation(doj, new Date()));
    // The date the banner shows — prefer the explicit originalEnd, fall
    // back to the derived 3-month boundary for legacy users.
    const probationEnd =
      p?.probationOriginalEndDate ??
      (doj ? probationEndDate(doj) : undefined);
    const today = new Date();
    // Awaiting-confirmation is true when:
    //   - status is explicitly 'in_progress' AND originalEndDate <= today, OR
    //   - status is unset (legacy) AND derived 3-month boundary <= today
    //     (the cron also picks these up for the admin notification).
    const explicitOriginalEnd = p?.probationOriginalEndDate
      ? new Date(p.probationOriginalEndDate)
      : null;
    const derivedEnd =
      !p?.probationStatus && doj ? probationEndDate(doj) : null;
    const effectiveOriginal = explicitOriginalEnd ?? derivedEnd;
    const awaitingConfirmation =
      onProbation &&
      Boolean(effectiveOriginal) &&
      (effectiveOriginal as Date).getTime() <= today.getTime();
    res.status(200).json({
      data: {
        onProbation,
        awaitingConfirmation: Boolean(awaitingConfirmation),
        dateOfJoining: doj ? doj.toISOString() : undefined,
        probationEnd: probationEnd ? probationEnd.toISOString() : undefined,
        probationStatus: p?.probationStatus ?? null,
        probationConfirmedEnd: p?.probationEndDate
          ? new Date(p.probationEndDate).toISOString()
          : undefined,
      },
    });
  } catch (error) {
    res.status(500).json({ error });
  }
};

export const createLeave = async (req: Request, res: Response) => {
  try {
    const user = req.user as UserDoc;
    const dateErr = validateDateOrder(req.body);
    if (dateErr) {
      res.status(400).json({ error: dateErr });
      return;
    }

    // Probation guard: while the employee is in their 3-month window,
    // only the unpaid bucket (UL) is a legal leave-type. Fetch the
    // profile + selected type, short-circuit with a 400 if the type
    // isn't unpaid. The React form already filters the picker, so this
    // is a defence-in-depth check, not the primary UX.
    if (req.body.leaveType) {
      const profileFilter = { user: user._id } as FilterQuery<
        Record<string, unknown>
      >;
      const [profile, type] = await Promise.all([
        UserProfileModel.findOne(profileFilter).select("dateOfJoining").lean(),
        LeaveTypeModel.findById(req.body.leaveType)
          .select("isUnpaidBucket name code requiresAttachment")
          .lean(),
      ]);
      const doj = (profile as { dateOfJoining?: Date } | null)?.dateOfJoining;
      if (
        isOnProbation(doj, new Date()) &&
        type &&
        !type.isUnpaidBucket
      ) {
        const endDate = doj
          ? probationEndDate(doj).toISOString().slice(0, 10)
          : "";
        res.status(400).json({
          error:
            `You are on probation until ${endDate}. Only unpaid leave is allowed during this period.`,
          probation: { onProbation: true, probationEnd: endDate },
        });
        return;
      }
      // ── Attachment requirement (e.g. Medical Leave) ──
      // The React form gates Submit on this too, but enforcing it
      // server-side closes the back-door for direct API calls and
      // legacy clients. The check is "at least one non-empty URL" so
      // an empty `[""]` array doesn't slip through.
      if (type?.requiresAttachment) {
        const attachments = Array.isArray(req.body.attachments)
          ? req.body.attachments.filter(
              (a: unknown) => typeof a === "string" && a.trim() !== "",
            )
          : [];
        if (attachments.length === 0) {
          res.status(400).json({
            error: `${type.name} requires supporting documentation. Please attach a medical certificate or doctor's note before submitting.`,
          });
          return;
        }
      }
    }

    // If the caller didn't precompute a split (legacy clients), derive one
    // from the monthly quota now so approval doesn't need to re-query.
    if (!Array.isArray(req.body.splitBreakdown) && req.body.leaveType) {
      try {
        const days = requestedDays(req.body);
        const monthNum = moment(req.body.startDate, "YYYY/MM/DD").month() + 1;
        const yearNum = moment(req.body.startDate, "YYYY/MM/DD").year();
        const { split } = await computeLeaveSplit({
          userId: user._id.toString(),
          leaveTypeId: req.body.leaveType,
          year: yearNum,
          month: monthNum,
          requestedDays: days,
        });
        req.body.splitBreakdown = split;
      } catch {
        // Non-fatal — leave without a split falls back to full-type deduction.
      }
    }

    // Denormalize the chosen leave type's NAME onto the legacy `type`
    // string field. The Leave schema declares `type` as a hardcoded
    // enum with `default: "Casual Leave"`, so when the React form
    // sends only `leaveType` (ObjectId) the default kicks in and the
    // admin grid + emails read "Casual Leave" regardless of what
    // the employee actually picked. Resolving the type doc here and
    // stamping `type = name` keeps that legacy field accurate.
    if (req.body.leaveType) {
      try {
        const typeDoc = await LeaveTypeModel.findById(req.body.leaveType)
          .select("name")
          .lean();
        if (typeDoc?.name) req.body.type = typeDoc.name;
      } catch {
        // Non-fatal — the leave will still save with the schema default.
      }
    }

    // Pass the ObjectId directly. The schema casts strings to
    // ObjectIds on save, but storing the raw ObjectId removes one
    // round-trip and keeps the type consistent with how the getLeaves
    // filter queries.
    const newLeave = new LeaveModel({
      ...req.body,
      userRef: user._id,
    });

    const data = await newLeave.save();
    const emailHtml = await getLeaveRequestTemplate(data.toObject<ILeave>());
    const recipients = leaveNotifyRecipients();
    const mailOptions = {
      from: mailSenders.leave.from,
      to: recipients.join(", "),
      // Reply-to stays the requesting user — HR replying goes to the
      // person who filed the leave, not the generic HR mailbox.
      replyTo: user.email,
      subject: getEmailSubject(user),
      html: emailHtml,
    };

    const { messageId } = await sendMail(mailOptions);
    data.emailRefIds = [...(data.emailRefIds || []), messageId];
    await data.save();

    // Event 10 — ping HR + Super Admins that a leave request needs review.
    // Super-admins are included so leadership sees every leave application
    // regardless of which HR member processes it (per product requirement).
    const reviewerIds = await UserModel.distinct("_id", {
      role: { $in: [UserRole.Hr, UserRole.SuperAdmin] },
      active: true,
    });
    void emitNotification({
      recipients: reviewerIds,
      type: "LEAVE_REQUESTED",
      title: `Leave request from ${user.firstName || user.email}`,
      body: `${user.firstName || ""} ${user.lastName || ""}`.trim() +
        ` requested leave: ${data.startDate} → ${data.endDate}`,
      link: { kind: "leave", leaveId: String(data._id) },
      actor: {
        _id: user._id,
        name: `${user.firstName || ""} ${user.lastName || ""}`.trim() || user.email,
      },
    });

    res.status(201).json({ data });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

// Fields the owner of a Pending leave is allowed to edit. Anything else in
// the body is stripped before the update so a malicious client can't slip in
// status / respondBy / paymentCategory.
const OWNER_EDITABLE_FIELDS = new Set([
  "startDate",
  "endDate",
  "reason",
  "type",
  "leaveType",
  "isHalfDay",
  "halfDayType",
  "attachments",
]);

export const updateLeave = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const me = req.user as UserDoc;
    const userId = me._id.toString();
    const myRoles = me.role || [];
    const isAdmin = myRoles.some(
      (r) =>
        r === UserRole.SuperAdmin ||
        r === UserRole.Admin ||
        r === UserRole.Hr,
    );

    const existingLeave = (await LeaveModel.findById(id)
      .lean()
      .exec()) as ILeave | null;

    if (!existingLeave) {
      res.status(404).json({ error: "Leave not found" });
      return;
    }

    const isOwner = existingLeave.userRef?.toString() === userId;
    const wantsDecision =
      "status" in req.body && req.body.status !== existingLeave.status;

    if (wantsDecision) {
      // Approve / reject / reopen — admin only.
      if (!isAdmin) {
        res.status(403).json({ error: "Only HR / Admin can change leave status" });
        return;
      }
    } else {
      // Non-decision edit — owner of a Pending leave, or any admin.
      if (!isOwner && !isAdmin) {
        res.status(403).json({ error: "You can only edit your own leave" });
        return;
      }
      if (existingLeave.status !== LeaveStatus.Pending) {
        res.status(400).json({
          error: `Cannot edit a leave that has already been ${existingLeave.status?.toLowerCase()}`,
        });
        return;
      }
      // Owners must stay within the safe-edit fields. Admins may also edit
      // freely here, but we still drop status-only bookkeeping fields.
      if (!isAdmin) {
        for (const key of Object.keys(req.body)) {
          if (!OWNER_EDITABLE_FIELDS.has(key)) delete req.body[key];
        }
      } else {
        delete req.body.status;
        delete req.body.respondBy;
        delete req.body.respondedAt;
      }
    }

    // If either date is being updated, validate the resulting range against
    // whichever side wasn't changed.
    if ("startDate" in req.body || "endDate" in req.body) {
      const merged = {
        startDate: req.body.startDate ?? existingLeave.startDate,
        endDate: req.body.endDate ?? existingLeave.endDate,
      };
      const dateErr = validateDateOrder(merged);
      if (dateErr) {
        res.status(400).json({ error: dateErr });
        return;
      }
    }

    // If dates or leave-type changed on a Pending leave, recompute the split
    // so the quota math stays accurate (unless the caller explicitly sent
    // their own splitBreakdown).
    const mutatedPayloadFields =
      "startDate" in req.body ||
      "endDate" in req.body ||
      "leaveType" in req.body ||
      "isHalfDay" in req.body;
    if (
      !wantsDecision &&
      mutatedPayloadFields &&
      !Array.isArray(req.body.splitBreakdown) &&
      existingLeave.status === LeaveStatus.Pending
    ) {
      const merged = {
        startDate: req.body.startDate ?? existingLeave.startDate,
        endDate: req.body.endDate ?? existingLeave.endDate,
        isHalfDay: req.body.isHalfDay ?? existingLeave.isHalfDay,
        leaveType: req.body.leaveType ?? existingLeave.leaveType,
      };
      if (merged.leaveType) {
        try {
          const days = requestedDays(merged);
          const monthNum = moment(merged.startDate, "YYYY/MM/DD").month() + 1;
          const yearNum = moment(merged.startDate, "YYYY/MM/DD").year();
          const { split } = await computeLeaveSplit({
            userId: existingLeave.userRef,
            leaveTypeId: merged.leaveType as unknown as string,
            year: yearNum,
            month: monthNum,
            requestedDays: days,
          });
          req.body.splitBreakdown = split;
        } catch {
          // Leave the old breakdown in place if recompute fails.
        }
      }
    }

    // If the caller changed `leaveType` to a different type, also
    // re-sync the denormalized `type` string so the admin grid +
    // email reflect the new pick. Same rationale as the createLeave
    // sync block above.
    if (req.body.leaveType) {
      try {
        const typeDoc = await LeaveTypeModel.findById(req.body.leaveType)
          .select("name")
          .lean();
        if (typeDoc?.name) req.body.type = typeDoc.name;
      } catch {
        // Non-fatal.
      }
    }

    if (
      existingLeave?.status === LeaveStatus.Pending &&
      req.body.status !== LeaveStatus.Pending &&
      req.body.status !== undefined
    ) {
      req.body.respondedAt = new Date();
      req.body.respondBy = userId;
    }

    const updatedLeave = await LeaveModel.findByIdAndUpdate(id, req.body, {
      new: true,
    });

    if (!updatedLeave) {
      res.status(404).json({ error: "Record not found" });
      return;
    }

    if (
      existingLeave?.status === LeaveStatus.Pending &&
      req.body.status !== LeaveStatus.Pending
    ) {
      const emailHtml = await getLeaveStatusTemplate(
        updatedLeave.toObject<ILeave>(),
      );

      const recepient = await UserModel.findById(existingLeave.userRef);

      if (!recepient) {
        res.status(404).json({ error: "Recepient not found" });
        return;
      }

      const lastMailRef =
        updatedLeave.emailRefIds?.[updatedLeave.emailRefIds?.length - 1];

      const mailOptions: MailOptions = {
        from: mailSenders.leave.from,
        to: recepient?.email,
        subject: (lastMailRef ? "Re: " : "") + getEmailSubject(recepient),
        html: emailHtml,
        replyTo: lastMailRef,
        references: lastMailRef ? [lastMailRef] : undefined,
      };

      const { messageId } = await sendMail(mailOptions);
      updatedLeave.emailRefIds = [
        ...(updatedLeave.emailRefIds || []),
        messageId,
      ];
      await updatedLeave.save();

      if (updatedLeave.status === LeaveStatus.Approved) {
        await applyBalanceEffects(updatedLeave);
        markAttendanceForLeave(updatedLeave.toObject<ILeave>());
      }

      // Event 11 — notify the employee that their leave got a decision.
      // Super-admins are also pinged so leadership keeps the full audit trail
      // of leave decisions (the actor is auto-excluded by the service so a
      // super-admin who took the action doesn't ping themselves).
      const statusWord =
        updatedLeave.status === LeaveStatus.Approved ? "approved" : "rejected";
      const superAdminIds = await UserModel.distinct("_id", {
        role: UserRole.SuperAdmin,
        active: true,
      });
      void emitNotification({
        recipients: [existingLeave.userRef, ...superAdminIds],
        type:
          updatedLeave.status === LeaveStatus.Approved
            ? "LEAVE_APPROVED"
            : "LEAVE_REJECTED",
        title: `Leave ${statusWord} for ${
          (await UserModel.findById(existingLeave.userRef).select("firstName email").lean())
            ?.firstName || "employee"
        }`,
        body: `${updatedLeave.startDate} → ${updatedLeave.endDate} — ${statusWord} by ${me.firstName || me.email}.`,
        link: { kind: "leave", leaveId: String(updatedLeave._id) },
        actor: {
          _id: me._id,
          name: `${me.firstName || ""} ${me.lastName || ""}`.trim() || me.email,
        },
      });
    }

    res.status(200).json({ data: updatedLeave });
  } catch (error) {
    res.status(500).json({ error: error });
  }
};

// On approval: deduct each split-breakdown entry from its respective balance.
// If no split was recorded (legacy leave or empty), fall back to the annual
// cap logic: deduct fully if balance allows, else reclassify to UL.
async function applyBalanceEffects(
  leave: Awaited<ReturnType<typeof LeaveModel.findById>>,
) {
  if (!leave || !leave.leaveType) return;
  const year = moment(leave.startDate, "YYYY/MM/DD").year();
  const userId = leave.userRef as unknown as Types.ObjectId;

  const split = leave.splitBreakdown?.filter((s) => s.days > 0) || [];

  // Preferred path: honor the split recorded at apply-time.
  if (split.length) {
    const unpaidType = await getUnpaidBucketType();
    for (const item of split) {
      await incrementUsed({
        userId,
        leaveTypeId: item.leaveType,
        year,
        days: item.days,
      });
    }
    const hasUnpaidPortion = unpaidType
      ? split.some((s) => s.leaveType.toString() === unpaidType._id.toString())
      : false;
    const reqType = await getLeaveTypeById(leave.leaveType);
    if (hasUnpaidPortion) {
      leave.paymentCategory = LeavePaymentCategory.Unpaid;
    } else if (reqType) {
      leave.paymentCategory = reqType.paid
        ? LeavePaymentCategory.Paid
        : LeavePaymentCategory.Unpaid;
    }
    await leave.save();
    return;
  }

  // Fallback — legacy path for leaves created before splits existed.
  const days = requestedDays({
    startDate: leave.startDate,
    endDate: leave.endDate,
    isHalfDay: leave.isHalfDay,
  });
  const reqType = await getLeaveTypeById(leave.leaveType);
  if (!reqType) return;

  if (reqType.isUnpaidBucket) {
    await incrementUsed({ userId, leaveTypeId: reqType._id, year, days });
    leave.paymentCategory = LeavePaymentCategory.Unpaid;
    await leave.save();
    return;
  }

  const balance = await getBalance(userId, year, reqType._id);
  const remaining = (balance?.allocated || 0) - (balance?.used || 0);

  if (days <= remaining) {
    await incrementUsed({ userId, leaveTypeId: reqType._id, year, days });
    leave.paymentCategory = reqType.paid
      ? LeavePaymentCategory.Paid
      : LeavePaymentCategory.Unpaid;
    await leave.save();
    return;
  }

  const unpaidType = await getUnpaidBucketType();
  if (!unpaidType) {
    leave.paymentCategory = LeavePaymentCategory.Unpaid;
    await leave.save();
    return;
  }
  leave.leaveType = unpaidType._id;
  leave.paymentCategory = LeavePaymentCategory.Unpaid;
  await leave.save();
  await incrementUsed({ userId, leaveTypeId: unpaidType._id, year, days });
}

// Reverse a previously-applied deduction (e.g. if HR rolls an Approved leave
// back to Pending or deletes it). Not currently wired to update/delete paths
// but exposed so we can add it cleanly.
export async function reverseBalanceEffects(
  leave: Pick<ILeave, "leaveType" | "startDate" | "endDate" | "isHalfDay" | "userRef" | "status">,
) {
  if (!leave.leaveType || leave.status !== LeaveStatus.Approved) return;
  const days = requestedDays({
    startDate: leave.startDate,
    endDate: leave.endDate,
    isHalfDay: leave.isHalfDay,
  });
  const year = moment(leave.startDate, "YYYY/MM/DD").year();
  await decrementUsed({
    userId: leave.userRef,
    leaveTypeId: leave.leaveType,
    year,
    days,
  });
}

function markAttendanceForLeave(leave: ILeave) {
  if (leave.status !== LeaveStatus.Approved) return;
  const startDate = moment(leave.startDate);
  const endDate = moment(leave.endDate);

  try {
    const dates: string[] = [];
    const current = startDate.clone();

    while (current.isSameOrBefore(endDate)) {
      const dow = current.day();
      // Skip Sat (6) / Sun (0) — weekends are non-working days, no attendance
      // row needed even if the leave span includes them.
      if (dow !== 0 && dow !== 6) {
        dates.push(current.format("YYYY/MM/DD"));
      }
      current.add(1, "days");
    }

    return Promise.allSettled(
      dates.map((date) =>
        handleMarkAttendance({
          userRef: leave.userRef,
          date,
          status: AttendanceStatus.Absent,
        }),
      ),
    );
  } catch (error) {
    console.log("Error in markAttendanceForLeave: ", error);
  }
}

export const deleteLeave = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const data = await LeaveModel.findByIdAndDelete(id);

    if (!data) {
      res.status(404).json({ error: "failed to delete" });
      return;
    }

    res.status(200).json({ data: "deleted successfully" });
  } catch (error) {
    res.status(500).json({ error });
  }
};
