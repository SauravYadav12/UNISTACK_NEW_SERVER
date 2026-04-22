import request from "supertest";
import { buildTestApp, makeUser } from "./testApp";
import { UserRole } from "../enums/UserEnum";

describe("/invoice-email-settings", () => {
  it("GET returns defaults on first call and seeds the singleton", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.User] });
    const res = await request(app)
      .get("/invoice-email-settings")
      .set("Authorization", token);
    expect(res.status).toBe(200);
    expect(res.body.data.raised.subject).toContain("{{invoiceNumber}}");
    expect(res.body.data.due.subject).toContain("Payment due");
    expect(res.body.data.timesheetApprovalRequest.subject).toContain(
      "Timesheet approval"
    );
  });

  it("PATCH updates just the raised block without nuking the others", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.Admin] });
    await request(app)
      .get("/invoice-email-settings")
      .set("Authorization", token); // seed defaults

    const res = await request(app)
      .patch("/invoice-email-settings")
      .set("Authorization", token)
      .send({ raised: { subject: "New raised subject {{invoiceNumber}}" } });
    expect(res.status).toBe(200);
    expect(res.body.data.raised.subject).toBe(
      "New raised subject {{invoiceNumber}}"
    );
    // Original due + approval blocks survive intact
    expect(res.body.data.due.subject).toContain("Payment due");
  });

  it("PATCH rejects bad shape", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.Admin] });
    const res = await request(app)
      .patch("/invoice-email-settings")
      .set("Authorization", token)
      .send({ raised: { subject: 42 } });
    expect(res.status).toBe(400);
  });

  it("PATCH requires admin or super-admin", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.ProjectCoordinator] });
    const res = await request(app)
      .patch("/invoice-email-settings")
      .set("Authorization", token)
      .send({ raised: { subject: "x" } });
    expect(res.status).toBe(403);
  });
});
