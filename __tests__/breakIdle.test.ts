import request from "supertest";
import { buildTestApp, makeUser } from "./testApp";
import { UserRole } from "../enums/UserEnum";
import { CheckInSessionModel } from "../models/checkInSessionModel";
import { BreakSessionModel } from "../models/breakSessionModel";
import { NotificationModel } from "../models/notificationModel";
import { invalidateBreakPolicyCache } from "../services/breakPolicyService";
import * as officeTime from "../utils/officeTime";

jest.mock("../controllers/storageController", () => ({
  __esModule: true, uploadBuffer: jest.fn(), uploadFile: jest.fn(), deleteS3ObjectByUrl: jest.fn(),
}));

async function checkedIn(roles: UserRole[] = [UserRole.User]) {
  const { user, token } = await makeUser({ roles });
  await CheckInSessionModel.create({ userRef: user._id, date: "2026-09-23", checkInAt: new Date(), checkOutAt: null });
  return { user, token };
}

let officeSpy: jest.SpyInstance;
beforeEach(() => {
  invalidateBreakPolicyCache();
  officeSpy = jest.spyOn(officeTime, "isWithinOfficeHours").mockReturnValue(true);
});
afterEach(() => officeSpy.mockRestore());

describe("POST /break/idle", () => {
  it("locks an inactive, checked-in employee with an admin-unlock idle break by default", async () => {
    const app = buildTestApp();
    const { user, token } = await checkedIn();
    const { user: admin } = await makeUser({ roles: [UserRole.Admin] });
    const { user: peer } = await checkedIn();

    const short = await request(app).post("/break/idle").set("Authorization", token).send({ idleSeconds: 120 });
    expect(short.status).toBe(400);
    expect(short.body.code).toBe("NOT_IDLE_ENOUGH");

    const res = await request(app).post("/break/idle").set("Authorization", token).send({ idleSeconds: 301 });
    expect(res.status).toBe(201);
    expect(res.body.data.source).toBe("idle");
    expect(res.body.data.unlockMode).toBe("admin");
    expect(res.body.data.reason).toMatch(/Inactive for 5 min/);

    const cur = await request(app).get("/break/current").set("Authorization", token);
    expect(cur.body.data.unlockMode).toBe("admin");
    expect(cur.body.data.idleMinutes).toBe(5);
    // OTP path refused, admin alerted, team told.
    expect((await request(app).post("/break/request-unlock-otp").set("Authorization", token)).status).toBe(403);
    expect(await NotificationModel.findOne({ type: "break.unannounced", recipientRef: admin._id })).toBeTruthy();
    const team = await NotificationModel.findOne({ type: "break.unannounced.team", recipientRef: peer._id });
    expect(team?.title).toMatch(/inactive/);
    // Idempotent.
    expect((await request(app).post("/break/idle").set("Authorization", token).send({ idleSeconds: 400 })).status).toBe(200);
    expect(await BreakSessionModel.countDocuments({ userRef: user._id })).toBe(1);
  });

  it("policy can make idle breaks OTP-unlockable or turn idle locking off", async () => {
    const app = buildTestApp();
    const { token: superTok } = await makeUser({ roles: [UserRole.SuperAdmin] });
    const { token } = await checkedIn();

    await request(app).put("/break/policy").set("Authorization", superTok).send({ idleMinutes: 2, idleUnlockMode: "otp" });
    const res = await request(app).post("/break/idle").set("Authorization", token).send({ idleSeconds: 130 });
    expect(res.status).toBe(201);
    expect(res.body.data.unlockMode).toBe("otp");
    expect((await request(app).post("/break/request-unlock-otp").set("Authorization", token)).status).toBe(200);

    const { token: other } = await checkedIn();
    await request(app).put("/break/policy").set("Authorization", superTok).send({ idleMinutes: 0 });
    const off = await request(app).post("/break/idle").set("Authorization", other).send({ idleSeconds: 9999 });
    expect(off.status).toBe(409);
    expect(off.body.code).toBe("IDLE_DISABLED");
    expect((await request(app).put("/break/policy").set("Authorization", superTok).send({ idleUnlockMode: "maybe" })).status).toBe(400);
  });

  it("refuses outside office hours, when not checked in, and for exempt roles", async () => {
    const app = buildTestApp();
    const { token } = await checkedIn();
    officeSpy.mockReturnValue(false);
    const out = await request(app).post("/break/idle").set("Authorization", token).send({ idleSeconds: 999 });
    expect(out.status).toBe(409);
    expect(out.body.code).toBe("OUTSIDE_OFFICE_HOURS");
    officeSpy.mockReturnValue(true);

    const { token: notIn } = await makeUser({ roles: [UserRole.User] });
    expect((await request(app).post("/break/idle").set("Authorization", notIn).send({ idleSeconds: 999 })).status).toBe(404);
    const { token: adminTok } = await checkedIn([UserRole.Admin]);
    expect((await request(app).post("/break/idle").set("Authorization", adminTok).send({ idleSeconds: 999 })).status).toBe(403);
  });
});
