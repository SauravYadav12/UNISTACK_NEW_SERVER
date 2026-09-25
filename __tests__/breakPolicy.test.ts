import request from "supertest";
import { buildTestApp, makeUser } from "./testApp";
import { UserRole } from "../enums/UserEnum";
import { CheckInSessionModel } from "../models/checkInSessionModel";
import { BreakSessionModel } from "../models/breakSessionModel";
import { PresenceStateModel } from "../models/presenceStateModel";
import { invalidateBreakPolicyCache } from "../services/breakPolicyService";
import { runBreakSweepTick } from "../services/breakSweepScheduler";

jest.mock("../controllers/storageController", () => ({
  __esModule: true,
  uploadBuffer: jest.fn(),
  uploadFile: jest.fn(),
  deleteS3ObjectByUrl: jest.fn(),
}));

const INSIDE = new Date("2026-09-23T18:00:00Z"); // Wed 14:00 EDT

async function checkedIn(roles: UserRole[]) {
  const { user, token } = await makeUser({ roles });
  await CheckInSessionModel.create({ userRef: user._id, date: "2026-09-23", checkInAt: new Date(), checkOutAt: null });
  return { user, token };
}

beforeEach(() => invalidateBreakPolicyCache());

describe("break policy", () => {
  it("defaults: feature on, every role except admin and super-admin", async () => {
    const app = buildTestApp();
    const { token: adminTok } = await makeUser({ roles: [UserRole.Admin] });
    const res = await request(app).get("/break/policy").set("Authorization", adminTok);
    expect(res.status).toBe(200);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.enabledRoles).toEqual(expect.arrayContaining([UserRole.User, UserRole.Hr, UserRole.Marketing]));
    expect(res.body.data.enabledRoles).not.toContain(UserRole.Admin);
    expect(res.body.data.enabledRoles).not.toContain(UserRole.SuperAdmin);
    expect(res.body.data.togglableRoles).not.toContain(UserRole.SuperAdmin);
    expect(res.body.data.autoLockMinutes).toBe(5);
  });

  it("only admins can read or change the policy; HR can read", async () => {
    const app = buildTestApp();
    const { token: userTok } = await makeUser({ roles: [UserRole.User] });
    const { token: hrTok } = await makeUser({ roles: [UserRole.Hr] });
    expect((await request(app).get("/break/policy").set("Authorization", userTok)).status).toBe(403);
    expect((await request(app).get("/break/policy").set("Authorization", hrTok)).status).toBe(200);
    expect((await request(app).put("/break/policy").set("Authorization", hrTok).send({ enabled: false })).status).toBe(403);
  });

  it("rejects bad patches", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.SuperAdmin] });
    expect((await request(app).put("/break/policy").set("Authorization", token).send({ enabledRoles: ["super-admin"] })).status).toBe(400);
    expect((await request(app).put("/break/policy").set("Authorization", token).send({ enabled: "yes" })).status).toBe(400);
    expect((await request(app).put("/break/policy").set("Authorization", token).send({ autoLockMinutes: 0 })).status).toBe(400);
  });

  it("disabling a role exempts those users everywhere and releases their open breaks", async () => {
    const app = buildTestApp();
    const { user: admin, token: adminTok } = await makeUser({ roles: [UserRole.SuperAdmin] });
    const { user: emp, token: empTok } = await checkedIn([UserRole.User]);
    const { user: mkt, token: mktTok } = await checkedIn([UserRole.Marketing]);

    // Employee is locked before the change.
    expect((await request(app).post("/break/start").set("Authorization", empTok)).status).toBe(201);

    const put = await request(app)
      .put("/break/policy")
      .set("Authorization", adminTok)
      .send({ enabledRoles: [UserRole.Marketing] });
    expect(put.status).toBe(200);
    expect(put.body.data.policy.enabledRoles).toEqual([UserRole.Marketing]);
    expect(put.body.data.policy.updatedByName).toContain(admin.firstName);
    expect(put.body.data.releasedBreaks).toBe(1);
    const released = await BreakSessionModel.findOne({ userRef: emp._id });
    expect(released?.endedSource).toBe("admin");
    expect(released?.reason).toMatch(/disabled/);

    // Now exempt: cannot start, current says exempt, presence ignored, sweep skips, board hides.
    expect((await request(app).post("/break/start").set("Authorization", empTok)).body.code).toBe("EXEMPT");
    const cur = await request(app).get("/break/current").set("Authorization", empTok);
    expect(cur.body.data.exempt).toBe(true);
    expect(cur.body.data.featureEnabled).toBe(true);
    const ev = await request(app).post("/presence/events").set("x-api-key", "test-presence-key").send({ userId: String(emp._id), type: "left" });
    expect(ev.body.data.ignored).toBe("exempt");
    await PresenceStateModel.create({ userRef: emp._id, awaySince: new Date(INSIDE.getTime() - 10 * 60 * 1000) });
    expect((await runBreakSweepTick(INSIDE)).locked).toBe(0);
    const board = await request(app).get("/presence/board").set("Authorization", mktTok);
    const ids = board.body.data.rows.map((r: { userRef: string }) => r.userRef);
    expect(ids).toContain(String(mkt._id));
    expect(ids).not.toContain(String(emp._id));

    // Marketing is still in the flow.
    expect((await request(app).post("/break/start").set("Authorization", mktTok)).status).toBe(201);
  });

  it("admins can be switched INTO the flow, and the master switch turns everything off", async () => {
    const app = buildTestApp();
    const { token: superTok } = await makeUser({ roles: [UserRole.SuperAdmin] });
    const { token: adminTok } = await checkedIn([UserRole.Admin]);

    expect((await request(app).post("/break/start").set("Authorization", adminTok)).body.code).toBe("EXEMPT");
    await request(app).put("/break/policy").set("Authorization", superTok).send({ enabledRoles: [UserRole.User, UserRole.Admin], autoLockMinutes: 3 });
    expect((await request(app).post("/break/start").set("Authorization", adminTok)).status).toBe(201);
    expect((await request(app).get("/break/current").set("Authorization", adminTok)).body.data.autoLockMinutes).toBe(3);

    const off = await request(app).put("/break/policy").set("Authorization", superTok).send({ enabled: false });
    expect(off.body.data.releasedBreaks).toBe(1);
    const cur = await request(app).get("/break/current").set("Authorization", adminTok);
    expect(cur.body.data.exempt).toBe(true);
    expect(cur.body.data.featureEnabled).toBe(false);
    await PresenceStateModel.create({ userRef: (await checkedIn([UserRole.User])).user._id, awaySince: new Date(INSIDE.getTime() - 10 * 60 * 1000) });
    expect((await runBreakSweepTick(INSIDE)).locked).toBe(0);

    // Super-admin can never be enabled.
    expect((await request(app).put("/break/policy").set("Authorization", superTok).send({ enabled: true, enabledRoles: ["super-admin"] })).status).toBe(400);
  });
});
