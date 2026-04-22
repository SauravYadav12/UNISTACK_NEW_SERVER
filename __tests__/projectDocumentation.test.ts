import request from "supertest";
import { buildTestApp, makeUser } from "./testApp";
import { UserRole } from "../enums/UserEnum";
import { ProjectModel } from "../models/projectModel";
import { OrganizationModel } from "../models/organizationModel";

async function seedProject() {
  const org = await OrganizationModel.create({
    orgId: "ORG-01",
    name: "Acme",
    shortCode: "ACM",
    active: true,
  });
  return ProjectModel.create({
    projectId: "PROJ-01",
    reqID: "REQ-1",
    organizationRef: org._id,
    organizationName: org.name,
    organizationShortCode: org.shortCode,
    status: "Active",
    rate: [{ value: 50, currency: "USD" }],
  });
}

describe("PATCH /projects/:id/documentation", () => {
  it("patches a single step without touching the others", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.Admin] });
    const project = await seedProject();

    const res = await request(app)
      .patch(`/projects/${project._id}/documentation`)
      .set("Authorization", token)
      .send({
        bgc: { status: "Done", notes: "BGC completed by vendor" },
      });
    expect(res.status).toBe(200);
    expect(res.body.data.documentation.bgc.status).toBe("Done");
    expect(res.body.data.documentation.bgc.notes).toBe("BGC completed by vendor");
    expect(res.body.data.documentation.contractSigned.status).toBe("Pending");
    expect(res.body.data.documentation.paymentTermsAccepted.status).toBe("Pending");
  });

  it("accepts extraNotes independently", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.Admin] });
    const project = await seedProject();
    const res = await request(app)
      .patch(`/projects/${project._id}/documentation`)
      .set("Authorization", token)
      .send({ extraNotes: "Client wants quarterly reviews" });
    expect(res.status).toBe(200);
    expect(res.body.data.documentation.extraNotes).toBe(
      "Client wants quarterly reviews"
    );
  });

  it("rejects invalid status value", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.Admin] });
    const project = await seedProject();
    const res = await request(app)
      .patch(`/projects/${project._id}/documentation`)
      .set("Authorization", token)
      .send({ bgc: { status: "Almost" } });
    expect(res.status).toBe(400);
  });

  it("rejects empty payload", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.Admin] });
    const project = await seedProject();
    const res = await request(app)
      .patch(`/projects/${project._id}/documentation`)
      .set("Authorization", token)
      .send({});
    expect(res.status).toBe(400);
  });

  it("ProjectCoordinator role can patch too", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.ProjectCoordinator] });
    const project = await seedProject();
    const res = await request(app)
      .patch(`/projects/${project._id}/documentation`)
      .set("Authorization", token)
      .send({ onboarding: { status: "Done" } });
    expect(res.status).toBe(200);
  });

  it("plain User role cannot patch", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.User] });
    const project = await seedProject();
    const res = await request(app)
      .patch(`/projects/${project._id}/documentation`)
      .set("Authorization", token)
      .send({ bgc: { status: "Done" } });
    expect(res.status).toBe(403);
  });
});
