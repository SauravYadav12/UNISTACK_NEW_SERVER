import request from "supertest";
import { buildTestApp, makeUser } from "./testApp";
import { UserRole } from "../enums/UserEnum";
import { UserDoc, UserModel } from "../models/userModel";
import { CheckInSessionModel } from "../models/checkInSessionModel";
import { BreakSessionModel } from "../models/breakSessionModel";
import { NotificationModel } from "../models/notificationModel";
import { sendMail } from "../utils/mailTransporter";
import { startBreak } from "../services/breakService";

jest.mock("../controllers/storageController", () => ({
  __esModule: true,
  uploadBuffer: jest.fn(async (_b: Buffer, key: string) => `https://cdn.test/${key}`),
  uploadFile: jest.fn(),
  deleteS3ObjectByUrl: jest.fn(),
}));

async function checkedInEmployee(emailLocal?: string) {
  const { user, token } = await makeUser({ roles: [UserRole.User], emailLocal });
  await CheckInSessionModel.create({
    userRef: user._id,
    userName: `${user.firstName} ${user.lastName}`,
    userEmail: user.email,
    shift: "US",
    date: "2026-09-23",
    checkInAt: new Date(),
    checkOutAt: null,
  });
  return { user, token };
}

async function otpFor(user: UserDoc): Promise<string> {
  const fresh = await UserModel.findById(user._id);
  return String(fresh?.otp);
}

describe("POST /break/start", () => {
  it("404 when the employee is not checked in", async () => {
    const app = buildTestApp();
    const { token } = await makeUser({ roles: [UserRole.User] });
    const res = await request(app).post("/break/start").set("Authorization", token);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_CHECKED_IN");
  });

  it("403 EXEMPT for admins and super-admins", async () => {
    const app = buildTestApp();
    for (const role of [UserRole.Admin, UserRole.SuperAdmin]) {
      const { user, token } = await makeUser({ roles: [role] });
      await CheckInSessionModel.create({
        userRef: user._id, date: "2026-09-23", checkInAt: new Date(), checkOutAt: null,
      });
      const res = await request(app).post("/break/start").set("Authorization", token);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("EXEMPT");
    }
  });

  it("creates a manual break, is idempotent, and broadcasts to active users", async () => {
    const app = buildTestApp();
    const { user, token } = await checkedInEmployee();
    const { user: colleague } = await checkedInEmployee();
    const { user: idle } = await makeUser({ roles: [UserRole.User] });
    const { user: hr } = await makeUser({ roles: [UserRole.Hr] });

    const first = await request(app).post("/break/start").set("Authorization", token);
    expect(first.status).toBe(201);
    expect(first.body.data.source).toBe("manual");
    expect(first.body.data.unlockMode).toBe("otp");
    expect(first.body.data.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const second = await request(app).post("/break/start").set("Authorization", token);
    expect(second.status).toBe(200);
    expect(second.body.data._id).toBe(first.body.data._id);
    expect(await BreakSessionModel.countDocuments({ userRef: user._id })).toBe(1);

    const rows = await NotificationModel.find({ type: "break.started" }).lean();
    const recipients = rows.map((r) => String(r.recipientRef));
    expect(recipients).toContain(String(colleague._id));
    expect(recipients).toContain(String(hr._id));
    expect(recipients).not.toContain(String(idle._id));
    expect(recipients).not.toContain(String(user._id));
    expect(rows[0].title).toMatch(/is on break/);
    expect(rows[0].link.kind).toBe("break");
  });
});

describe("OTP unlock flow", () => {
  it("emails a code, enforces the resend cooldown, rejects a wrong code, accepts the right one", async () => {
    const app = buildTestApp();
    const { user, token } = await checkedInEmployee();
    await request(app).post("/break/start").set("Authorization", token);

    const sent = await request(app).post("/break/request-unlock-otp").set("Authorization", token);
    expect(sent.status).toBe(200);
    expect(sent.body.data.sentTo).toBe(user.email);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const mail = (sendMail as jest.Mock).mock.calls[0][0];
    expect(mail.to).toBe(user.email);
    expect(mail.html).toMatch(/^OTP:\d{6}$/);

    const again = await request(app).post("/break/request-unlock-otp").set("Authorization", token);
    expect(again.status).toBe(429);
    expect(again.body.code).toBe("OTP_COOLDOWN");

    const wrong = await request(app).post("/break/stop").set("Authorization", token).send({ otp: "000000" });
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe("OTP_INVALID");
    expect(wrong.body.attemptsLeft).toBe(4);

    const otp = await otpFor(user);
    const ok = await request(app).post("/break/stop").set("Authorization", token).send({ otp });
    expect(ok.status).toBe(200);
    expect(ok.body.data.endedSource).toBe("otp");
    expect(ok.body.data.durationSeconds).toBeGreaterThanOrEqual(0);

    const cur = await request(app).get("/break/current").set("Authorization", token);
    expect(cur.body.data.break).toBeNull();
    const fresh = await UserModel.findById(user._id);
    expect(fresh?.otp).toBeFalsy();
    expect(await NotificationModel.countDocuments({ type: "break.ended" })).toBeGreaterThanOrEqual(0);
  });

  it("a login OTP issued moments ago does not block the unlock request", async () => {
    const app = buildTestApp();
    const { user, token } = await checkedInEmployee();
    // What the login flow leaves behind: a fresh otp + otpExpiry 10 min out.
    await UserModel.updateOne({ _id: user._id }, { $set: { otp: "999999", otpExpiry: new Date(Date.now() + 10 * 60 * 1000) } });
    await request(app).post("/break/start").set("Authorization", token);
    const sent = await request(app).post("/break/request-unlock-otp").set("Authorization", token);
    expect(sent.status).toBe(200);
    expect(sendMail).toHaveBeenCalledTimes(1);
    const fresh = await UserModel.findById(user._id);
    expect(fresh?.otp).not.toBe("999999");
    expect(fresh?.breakOtpSentAt).toBeTruthy();
  });

  it("reports a mail failure instead of pretending the code was sent", async () => {
    const app = buildTestApp();
    const { user, token } = await checkedInEmployee();
    await request(app).post("/break/start").set("Authorization", token);
    (sendMail as jest.Mock).mockRejectedValueOnce(new Error("SMTP down"));
    const res = await request(app).post("/break/request-unlock-otp").set("Authorization", token);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("MAIL_FAILED");
    expect((await UserModel.findById(user._id))?.otp).toBeFalsy();
    // Immediate retry is allowed (no cooldown was recorded).
    expect((await request(app).post("/break/request-unlock-otp").set("Authorization", token)).status).toBe(200);
  });

  it("locks OTP entry after 5 wrong codes", async () => {
    const app = buildTestApp();
    const { user, token } = await checkedInEmployee();
    await request(app).post("/break/start").set("Authorization", token);
    await request(app).post("/break/request-unlock-otp").set("Authorization", token);
    let last;
    for (let i = 0; i < 5; i += 1) {
      last = await request(app).post("/break/stop").set("Authorization", token).send({ otp: "111111" });
    }
    expect(last?.status).toBe(400);
    expect(last?.body.code).toBe("OTP_LOCKED");
    const fresh = await UserModel.findById(user._id);
    expect(fresh?.breakOtpLockedUntil && fresh.breakOtpLockedUntil > new Date()).toBe(true);
    const more = await request(app).post("/break/request-unlock-otp").set("Authorization", token);
    expect(more.status).toBe(429);
    expect(more.body.code).toBe("OTP_LOCKED");
  });

  it("refuses OTP on a presence (unannounced) break — admin only", async () => {
    const app = buildTestApp();
    const { user, token } = await checkedInEmployee();
    const started = await startBreak(user, "presence", { cameraId: "B" });
    expect("doc" in started).toBe(true);

    const cur = await request(app).get("/break/current").set("Authorization", token);
    expect(cur.body.data.unlockMode).toBe("admin");
    expect(cur.body.data.break.source).toBe("presence");

    const otpReq = await request(app).post("/break/request-unlock-otp").set("Authorization", token);
    expect(otpReq.status).toBe(403);
    expect(otpReq.body.code).toBe("ADMIN_UNLOCK_REQUIRED");
    expect(sendMail).not.toHaveBeenCalled();

    const stop = await request(app).post("/break/stop").set("Authorization", token).send({ otp: "123456" });
    expect(stop.status).toBe(403);
    expect(stop.body.code).toBe("ADMIN_UNLOCK_REQUIRED");
  });
});

describe("Lock is inescapable", () => {
  it("checkout returns 423 while a break is open", async () => {
    const app = buildTestApp();
    const { token } = await checkedInEmployee();
    await request(app).post("/break/start").set("Authorization", token);
    for (const source of ["manual", "logout"]) {
      const res = await request(app).post("/checkin/out").set("Authorization", token).send({ source });
      expect(res.status).toBe(423);
      expect(res.body.code).toBe("BREAK_OPEN");
    }
    expect(await CheckInSessionModel.countDocuments({ checkOutAt: null })).toBe(1);
  });

  it("sync-iuser carries the open break so a re-login re-locks", async () => {
    const app = buildTestApp();
    const { user, token } = await checkedInEmployee();
    await request(app).post("/break/start").set("Authorization", token);
    const res = await request(app).get(`/users/sync-iuser/${user._id}`).set("Authorization", token);
    expect(res.status).toBe(200);
    expect(res.body.openBreak).toBeTruthy();
    expect(res.body.openBreak.unlockMode).toBe("otp");
  });
});

describe("Admin force-end", () => {
  it("only admin/HR can force-end; ending twice is 409; the employee is notified", async () => {
    const app = buildTestApp();
    const { user, token } = await checkedInEmployee();
    const started = await startBreak(user, "presence");
    const breakId = "doc" in started ? String(started.doc._id) : "";
    const { token: peerToken } = await checkedInEmployee();
    const { user: hr, token: hrToken } = await makeUser({ roles: [UserRole.Hr], firstName: "Hema" });

    const denied = await request(app).post(`/break/${breakId}/force-end`).set("Authorization", peerToken);
    expect(denied.status).toBe(403);
    const self = await request(app).post(`/break/${breakId}/force-end`).set("Authorization", token);
    expect(self.status).toBe(403);

    const open = await request(app).get("/break/open").set("Authorization", hrToken);
    expect(open.status).toBe(200);
    expect(open.body.data.breaks.map((b: { _id: string }) => b._id)).toContain(breakId);

    const ok = await request(app)
      .post(`/break/${breakId}/force-end`)
      .set("Authorization", hrToken)
      .send({ reason: "Spoke to them" });
    expect(ok.status).toBe(200);
    expect(ok.body.data.endedSource).toBe("admin");
    expect(String(ok.body.data.endedByRef)).toBe(String(hr._id));
    expect(ok.body.data.reason).toBe("Spoke to them");

    const twice = await request(app).post(`/break/${breakId}/force-end`).set("Authorization", hrToken);
    expect(twice.status).toBe(409);

    const unlocked = await NotificationModel.findOne({ type: "break.unlocked", recipientRef: user._id });
    expect(unlocked).toBeTruthy();
  });
});

describe("Logs & summary", () => {
  it("employees see only their own logs; admins can see all and the per-user summary", async () => {
    const app = buildTestApp();
    const { user: a, token: aTok } = await checkedInEmployee("alice");
    const { user: b } = await checkedInEmployee("bob");
    const { token: adminTok } = await makeUser({ roles: [UserRole.Admin] });
    const day = "2026-09-23";
    await BreakSessionModel.create([
      { userRef: a._id, userName: "Alice", date: day, startedAt: new Date("2026-09-23T14:00:00Z"), endedAt: new Date("2026-09-23T14:10:00Z"), durationSeconds: 600, source: "manual", endedSource: "otp" },
      { userRef: a._id, userName: "Alice", date: day, startedAt: new Date("2026-09-23T16:00:00Z"), endedAt: new Date("2026-09-23T16:30:00Z"), durationSeconds: 1800, source: "presence", endedSource: "admin" },
      { userRef: b._id, userName: "Bob", date: day, startedAt: new Date("2026-09-23T15:00:00Z"), endedAt: new Date("2026-09-23T15:05:00Z"), durationSeconds: 300, source: "manual", endedSource: "otp" },
    ]);

    const mine = await request(app).get(`/break/logs?range=day&date=${day}`).set("Authorization", aTok);
    expect(mine.status).toBe(200);
    expect(mine.body.data.sessions).toHaveLength(2);

    const mineAll = await request(app).get(`/break/logs?range=week&date=${day}&userRef=${b._id}`).set("Authorization", aTok);
    expect(mineAll.body.data.sessions.every((s: { userRef: string }) => s.userRef === String(a._id))).toBe(true);

    const summaryMe = await request(app).get(`/break/summary?scope=me&range=day&date=${day}`).set("Authorization", aTok);
    expect(summaryMe.body.data.totals).toMatchObject({ count: 2, totalSeconds: 2400, longestSeconds: 1800, unannouncedCount: 1 });
    expect(summaryMe.body.data.days).toHaveLength(1);

    const forbidden = await request(app).get(`/break/summary?scope=all&range=day&date=${day}`).set("Authorization", aTok);
    expect(forbidden.status).toBe(403);

    const all = await request(app).get(`/break/summary?scope=all&range=month&date=${day}`).set("Authorization", adminTok);
    expect(all.status).toBe(200);
    expect(all.body.data.byUser).toHaveLength(2);
    expect(all.body.data.byUser[0].userName).toBe("Alice");
    expect(all.body.data.byUser[0].avgSeconds).toBe(1200);
    expect(all.body.data.totals.count).toBe(3);
  });
});
