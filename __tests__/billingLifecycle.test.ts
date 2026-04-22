import request from "supertest";
import { buildTestApp, makeUser } from "./testApp";
import { UserRole } from "../enums/UserEnum";
import { OrganizationModel } from "../models/organizationModel";
import { ProjectModel } from "../models/projectModel";
import { RequirementModel } from "../models/requirementModel";
import mongoose from "mongoose";

// Helper: seed the prerequisites for a billing test — one org + one project
// with a $50/hr rate. Returns key ids so the rest of the test can drive
// endpoints.
async function seedOrgAndProject(opts?: { rate?: number; taxPercent?: number }) {
  const rate = opts?.rate ?? 50;
  const org = await OrganizationModel.create({
    orgId: "ORG-01",
    name: "Acme Corp",
    shortCode: "ACM",
    active: true,
  });

  const req = await RequirementModel.create({
    reqID: "REQ-100",
    reqEnteredByRef: new mongoose.Types.ObjectId(),
    clientCompany: "Client Co",
    clientEmail: "client@example.com",
    vendorCompany: "Vendor Co",
    rate: [{ value: rate, currency: "USD" }],
    taxType: ["C2C"],
    duration: ["06 Months"],
    jobTitle: "Sr Dev",
    appliedFor: "Jane Doe",
  });

  const project = await ProjectModel.create({
    projectId: "PROJ-01",
    reqID: req.reqID,
    requirementRef: req._id,
    organizationRef: org._id,
    organizationName: org.name,
    organizationShortCode: org.shortCode,
    clientCompany: req.clientCompany,
    clientEmail: req.clientEmail,
    vendorCompany: req.vendorCompany,
    rate: req.rate,
    taxType: req.taxType,
    duration: req.duration,
    jobTitle: req.jobTitle,
    consultant: req.appliedFor,
    status: "Active",
    paymentTerms: { preset: "Net 30", days: 30 },
    taxPercent: opts?.taxPercent ?? 0,
    billingUnit: "hourly",
  });

  return { org, project };
}

async function upsertWeek(
  token: string,
  projectId: mongoose.Types.ObjectId,
  weekStart: string,
  dailyHours: number[]
) {
  const app = buildTestApp();
  const entries = dailyHours.map((h, i) => {
    const d = new Date(weekStart + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), hours: h };
  });
  const res = await request(app)
    .post("/timesheets/upsert")
    .set("Authorization", token)
    .send({ projectRef: String(projectId), weekStart, entries });
  return res;
}

describe("billing lifecycle: timesheet → approve → auto invoice → raise → paid", () => {
  it("end-to-end happy path", async () => {
    const app = buildTestApp();
    const { token: admin } = await makeUser({ roles: [UserRole.Admin] });
    const { token: superadmin } = await makeUser({
      roles: [UserRole.SuperAdmin],
    });
    const { project } = await seedOrgAndProject({ rate: 50, taxPercent: 10 });

    // Week of 2026-04-06 (Mon) → 40h
    const w1 = await upsertWeek(admin, project._id, "2026-04-06", [8, 8, 8, 8, 8, 0, 0]);
    expect(w1.status).toBe(200);
    expect(w1.body.data.totalHours).toBe(40);
    expect(w1.body.data.periodMonth).toBe("2026-04");

    // Week of 2026-04-13 → 32h (one day off)
    const w2 = await upsertWeek(admin, project._id, "2026-04-13", [8, 8, 0, 8, 8, 0, 0]);
    expect(w2.status).toBe(200);
    expect(w2.body.data.totalHours).toBe(32);

    // Submit for approval
    const submit = await request(app)
      .post("/timesheet-approvals/submit")
      .set("Authorization", admin)
      .send({ projectRef: String(project._id), periodMonth: "2026-04" });
    expect(submit.status).toBe(200);
    expect(submit.body.data.status).toBe("Requested");
    expect(submit.body.data.totalHoursAtSubmission).toBe(72);

    // Double-submit rejected
    const again = await request(app)
      .post("/timesheet-approvals/submit")
      .set("Authorization", admin)
      .send({ projectRef: String(project._id), periodMonth: "2026-04" });
    expect(again.status).toBe(409);

    // Admin cannot approve — only super-admin
    const adminApprove = await request(app)
      .post(`/timesheet-approvals/${submit.body.data._id}/approve`)
      .set("Authorization", admin);
    expect(adminApprove.status).toBe(403);

    // Super-admin approves → invoice draft auto-created
    const approve = await request(app)
      .post(`/timesheet-approvals/${submit.body.data._id}/approve`)
      .set("Authorization", superadmin);
    expect(approve.status).toBe(200);
    const { approval, invoice } = approve.body.data;
    expect(approval.status).toBe("Approved");
    expect(invoice).toBeTruthy();
    expect(invoice.status).toBe("Draft");
    expect(invoice.lineItems.length).toBe(2);
    expect(invoice.subtotal).toBe(50 * 72); // 3600
    expect(invoice.taxPercent).toBe(10);
    expect(invoice.taxAmount).toBe(360);
    expect(invoice.total).toBe(3960);
    expect(invoice.invoiceNumber).toMatch(/^INV-ACM-202604-\d{2}$/);
    expect(invoice.approvalRef).toBe(approval._id);

    // Edit the draft: add a reimbursement line item
    const withExtra = [
      ...invoice.lineItems,
      { description: "Software reimbursement", amount: 200 },
    ];
    const edit = await request(app)
      .patch(`/invoices/${invoice._id}`)
      .set("Authorization", admin)
      .send({ lineItems: withExtra });
    expect(edit.status).toBe(200);
    expect(edit.body.data.subtotal).toBe(3800);
    expect(edit.body.data.total).toBe(4180);

    // Raise (no PDF yet)
    const raise = await request(app)
      .post(`/invoices/${invoice._id}/raise`)
      .set("Authorization", admin)
      .send({ issueDate: "2026-05-01" });
    expect(raise.status).toBe(200);
    expect(raise.body.data.status).toBe("Raised");
    expect(raise.body.data.issueDate).toBe("2026-05-01");
    expect(raise.body.data.dueDate).toBe("2026-05-31"); // Net 30
    // Client email should be on the recipient list (client flag is default)
    expect(raise.body.data.emailedTo).toContain("client@example.com");

    // Cannot delete a Raised invoice
    const tryDel = await request(app)
      .delete(`/invoices/${invoice._id}`)
      .set("Authorization", admin);
    expect(tryDel.status).toBe(409);

    // Cannot edit a Raised invoice
    const tryEdit = await request(app)
      .patch(`/invoices/${invoice._id}`)
      .set("Authorization", admin)
      .send({ notes: "late edit" });
    expect(tryEdit.status).toBe(409);

    // Mark paid
    const paid = await request(app)
      .post(`/invoices/${invoice._id}/mark-paid`)
      .set("Authorization", admin)
      .send({ paidOn: "2026-05-20", paymentReference: "ACH-12345" });
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe("Paid");
    expect(paid.body.data.paidOn).toBe("2026-05-20");

    // Mark unpaid (reverts to Raised since dueDate is still in the future)
    const unpaid = await request(app)
      .post(`/invoices/${invoice._id}/mark-unpaid`)
      .set("Authorization", admin);
    expect(unpaid.status).toBe(200);
    // 2026-05-31 > today in test env (runs now-ish) → Raised
    expect(["Raised", "Due"]).toContain(unpaid.body.data.status);
  });

  it("rejects timesheet edits for a submitted month", async () => {
    const app = buildTestApp();
    const { token: admin } = await makeUser({ roles: [UserRole.Admin] });
    const { project } = await seedOrgAndProject();
    await upsertWeek(admin, project._id, "2026-04-06", [8, 8, 8, 8, 8, 0, 0]);

    await request(app)
      .post("/timesheet-approvals/submit")
      .set("Authorization", admin)
      .send({ projectRef: String(project._id), periodMonth: "2026-04" });

    // After submit, cannot re-save that week
    const blocked = await upsertWeek(admin, project._id, "2026-04-13", [8, 8, 8, 8, 8, 0, 0]);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/requested/i);
  });

  it("reject → resubmit cycle", async () => {
    const app = buildTestApp();
    const { token: admin } = await makeUser({ roles: [UserRole.Admin] });
    const { token: sa } = await makeUser({ roles: [UserRole.SuperAdmin] });
    const { project } = await seedOrgAndProject();

    await upsertWeek(admin, project._id, "2026-04-06", [8, 8, 8, 8, 8, 0, 0]);
    const submit = await request(app)
      .post("/timesheet-approvals/submit")
      .set("Authorization", admin)
      .send({ projectRef: String(project._id), periodMonth: "2026-04" });

    const reject = await request(app)
      .post(`/timesheet-approvals/${submit.body.data._id}/reject`)
      .set("Authorization", sa)
      .send({ reason: "Missed a holiday" });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe("Rejected");

    // Now the admin can edit again and re-submit
    const w2 = await upsertWeek(admin, project._id, "2026-04-13", [8, 8, 8, 8, 8, 0, 0]);
    expect(w2.status).toBe(200);

    const resubmit = await request(app)
      .post("/timesheet-approvals/submit")
      .set("Authorization", admin)
      .send({ projectRef: String(project._id), periodMonth: "2026-04" });
    expect(resubmit.status).toBe(200);
    expect(resubmit.body.data.status).toBe("Requested");
    // Same approval doc, not a new one
    expect(resubmit.body.data._id).toBe(submit.body.data._id);
  });
});
