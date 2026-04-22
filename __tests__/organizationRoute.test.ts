import request from "supertest";
import { buildTestApp, makeUser } from "./testApp";
import { UserRole } from "../enums/UserEnum";

describe("/organizations route", () => {
  it("requires JWT to list", async () => {
    const app = buildTestApp();
    const res = await request(app).get("/organizations/get-organizations");
    expect(res.status).toBe(401);
  });

  it("creates an org, lists it, fetches by id", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.SuperAdmin] });

    const create = await request(app)
      .post("/organizations/create-organization")
      .set("Authorization", token)
      .send({ name: "Unicodez Softcorp", shortCode: "UNI" });
    expect(create.status).toBe(200);
    expect(create.body.data.shortCode).toBe("UNI");
    expect(create.body.data.orgId).toMatch(/^ORG-/);

    const list = await request(app)
      .get("/organizations/get-organizations")
      .set("Authorization", token);
    expect(list.status).toBe(200);
    expect(list.body.data.results.length).toBe(1);

    const one = await request(app)
      .get(`/organizations/get-organization/${create.body.data._id}`)
      .set("Authorization", token);
    expect(one.status).toBe(200);
    expect(one.body.data.name).toBe("Unicodez Softcorp");
  });

  it("rejects duplicate shortCode with a clean 409", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.SuperAdmin] });

    const first = await request(app)
      .post("/organizations/create-organization")
      .set("Authorization", token)
      .send({ name: "Acme Corp", shortCode: "ACM" });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post("/organizations/create-organization")
      .set("Authorization", token)
      .send({ name: "Acme Corp 2", shortCode: "ACM" });
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/already in use/i);
  });

  it("auto-derives shortCode from name when absent", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.SuperAdmin] });

    const res = await request(app)
      .post("/organizations/create-organization")
      .set("Authorization", token)
      .send({ name: "Globex Industries" });
    expect(res.status).toBe(200);
    // First 3 uppercase letters: "GLO"
    expect(res.body.data.shortCode).toBe("GLO");
  });

  it("archive / activate toggles active flag", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.SuperAdmin] });
    const create = await request(app)
      .post("/organizations/create-organization")
      .set("Authorization", token)
      .send({ name: "X Org", shortCode: "XOR" });
    const id = create.body.data._id;

    const arch = await request(app)
      .post(`/organizations/${id}/archive`)
      .set("Authorization", token);
    expect(arch.status).toBe(200);
    expect(arch.body.data.active).toBe(false);

    const act = await request(app)
      .post(`/organizations/${id}/activate`)
      .set("Authorization", token);
    expect(act.status).toBe(200);
    expect(act.body.data.active).toBe(true);
  });

  it("a plain User (no admin roles) can read but not create", async () => {
    const app = buildTestApp();
    const { token: readerToken } = await makeUser({ roles: [UserRole.User] });
    const { token: admin } = await makeUser({ roles: [UserRole.Admin] });

    await request(app)
      .post("/organizations/create-organization")
      .set("Authorization", admin)
      .send({ name: "Readable", shortCode: "RED" });

    const list = await request(app)
      .get("/organizations/get-organizations")
      .set("Authorization", readerToken);
    expect(list.status).toBe(200); // GET is jwt-only

    const forbidden = await request(app)
      .post("/organizations/create-organization")
      .set("Authorization", readerToken)
      .send({ name: "Blocked", shortCode: "BLK" });
    expect(forbidden.status).toBe(403);
  });
});
