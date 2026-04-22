import { runInvoiceDueTick } from "../services/invoiceDueScheduler";
import { InvoiceModel } from "../models/invoiceModel";
import { ProjectModel } from "../models/projectModel";
import { OrganizationModel } from "../models/organizationModel";
import { TimesheetApprovalModel } from "../models/timesheetApprovalModel";
import mongoose from "mongoose";

let seedCounter = 0;

async function seedInvoice(opts: {
  dueDate: string;
  status: "Draft" | "Raised" | "Paid" | "Due";
  dueNotifiedAt?: Date | null;
}) {
  // Unique suffix so the same test can seed multiple invoices without tripping
  // the unique indexes on orgId / projectId / reqID.
  const n = ++seedCounter;
  const pad = n.toString().padStart(2, "0");
  const org = await OrganizationModel.create({
    orgId: `ORG-${pad}`,
    name: `Acme ${n}`,
    shortCode: `AC${pad}`.slice(0, 5),
    active: true,
  });
  const project = await ProjectModel.create({
    projectId: `PROJ-${pad}`,
    reqID: `REQ-${pad}-${Math.floor(Math.random() * 1e6)}`,
    organizationRef: org._id,
    organizationName: org.name,
    organizationShortCode: org.shortCode,
    rate: [{ value: 50, currency: "USD" }],
    paymentTerms: { preset: "Net 30", days: 30 },
    status: "Active",
  });
  const approval = await TimesheetApprovalModel.create({
    projectRef: project._id,
    projectId: project.projectId,
    organizationRef: org._id,
    periodMonth: "2026-04",
    status: "Approved",
    timesheetIds: [],
  });
  return InvoiceModel.create({
    // Unique invoice number per seed so collisions never bite the tests.
    invoiceNumber: `INV-AC${pad}-202604-${pad}`,
    projectRef: project._id,
    projectId: project.projectId,
    organizationRef: org._id,
    organizationName: org.name,
    periodMonth: "2026-04",
    lineItems: [{ description: "Svc", amount: 1000 }],
    taxPercent: 0,
    currency: "USD",
    status: opts.status,
    issueDate: "2026-04-01",
    dueDate: opts.dueDate,
    // Schema invariant: Paid invoices need paidOn. Fill a plausible value
    // so the pre-save hook accepts the seeded document.
    paidOn: opts.status === "Paid" ? "2026-04-20" : undefined,
    approvalRef: approval._id,
    dueNotifiedAt: opts.dueNotifiedAt ?? null,
  });
}

describe("invoiceDueScheduler.runInvoiceDueTick", () => {
  it("flips a Raised invoice with a past dueDate to Due and stamps dueNotifiedAt", async () => {
    const inv = await seedInvoice({ dueDate: "2020-01-01", status: "Raised" });
    const out = await runInvoiceDueTick();
    expect(out.flipped).toBe(1);

    const reloaded = await InvoiceModel.findById(inv._id);
    expect(reloaded?.status).toBe("Due");
    expect(reloaded?.dueNotifiedAt).toBeTruthy();
  });

  it("is idempotent — rerunning does not re-flip or re-alert", async () => {
    await seedInvoice({ dueDate: "2020-01-01", status: "Raised" });
    const first = await runInvoiceDueTick();
    expect(first.flipped).toBe(1);

    const second = await runInvoiceDueTick();
    expect(second.flipped).toBe(0);
    expect(second.alerted).toBe(0);
  });

  it("ignores invoices that are not Raised or have a future dueDate", async () => {
    // future dueDate
    await seedInvoice({ dueDate: "2099-01-01", status: "Raised" });
    // draft
    await seedInvoice({ dueDate: "2020-01-01", status: "Draft" });
    // already paid
    const paid = await seedInvoice({ dueDate: "2020-01-01", status: "Paid" });
    // already notified
    await seedInvoice({
      dueDate: "2020-01-01",
      status: "Raised",
      dueNotifiedAt: new Date(),
    });

    const out = await runInvoiceDueTick();
    expect(out.flipped).toBe(0);

    // The already-paid invoice should still be Paid.
    const stillPaid = await InvoiceModel.findById(paid._id);
    expect(stillPaid?.status).toBe("Paid");
  });

  afterAll(async () => {
    // no-op — setup.ts handles truncation between tests
    if (mongoose.connection.readyState === 0) {
      // noop
    }
  });
});
