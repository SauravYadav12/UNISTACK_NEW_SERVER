import request from "supertest";
import { buildTestApp, makeUser } from "./testApp";
import { UserRole } from "../enums/UserEnum";
import { OrganizationModel } from "../models/organizationModel";
import { RequirementModel } from "../models/requirementModel";
import mongoose from "mongoose";

async function seed() {
  const org = await OrganizationModel.create({
    orgId: "ORG-01",
    name: "Acme",
    shortCode: "ACM",
    active: true,
  });
  await RequirementModel.create({
    reqID: "REQ-500",
    reqEnteredByRef: new mongoose.Types.ObjectId(),
    clientCompany: "Client Co",
    rate: [{ value: 60, currency: "USD" }],
    jobTitle: "Engineer",
    appliedFor: "Consult A",
  });
  return { org };
}

describe("POST /projects/create-project — org-required", () => {
  it("400 without organizationId", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.Admin] });
    await seed();
    const res = await request(app)
      .post("/projects/create-project")
      .set("Authorization", token)
      .send({ reqID: "REQ-500" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/organizationId/i);
  });

  it("400 when organizationId is unknown", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.Admin] });
    await seed();
    const res = await request(app)
      .post("/projects/create-project")
      .set("Authorization", token)
      .send({
        reqID: "REQ-500",
        organizationId: new mongoose.Types.ObjectId().toString(),
      });
    expect(res.status).toBe(400);
  });

  it("snapshots org fields onto the project", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.Admin] });
    const { org } = await seed();
    const res = await request(app)
      .post("/projects/create-project")
      .set("Authorization", token)
      .send({ reqID: "REQ-500", organizationId: String(org._id) });
    expect(res.status).toBe(200);
    expect(res.body.data.organizationRef).toBe(String(org._id));
    expect(res.body.data.organizationName).toBe("Acme");
    expect(res.body.data.organizationShortCode).toBe("ACM");
    expect(res.body.data.rate).toEqual([{ value: 60, currency: "USD" }]);
  });

  it("409 if a project already exists for the reqID", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.Admin] });
    const { org } = await seed();
    const first = await request(app)
      .post("/projects/create-project")
      .set("Authorization", token)
      .send({ reqID: "REQ-500", organizationId: String(org._id) });
    expect(first.status).toBe(200);

    const dup = await request(app)
      .post("/projects/create-project")
      .set("Authorization", token)
      .send({ reqID: "REQ-500", organizationId: String(org._id) });
    expect(dup.status).toBe(409);
  });
});
