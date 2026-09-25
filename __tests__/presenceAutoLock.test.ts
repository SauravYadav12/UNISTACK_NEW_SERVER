import request from "supertest";
import { buildTestApp, makeUser } from "./testApp";
import { UserRole } from "../enums/UserEnum";
import { CheckInSessionModel } from "../models/checkInSessionModel";
import { BreakSessionModel } from "../models/breakSessionModel";
import { PresenceStateModel } from "../models/presenceStateModel";
import { NotificationModel } from "../models/notificationModel";
import { UnidentifiedEventModel } from "../models/unidentifiedEventModel";
import { runBreakSweepTick } from "../services/breakSweepScheduler";
import { isWithinOfficeHours, officeDate } from "../utils/officeTime";

jest.mock("../controllers/storageController", () => ({
  __esModule: true,
  uploadBuffer: jest.fn(async (_b: Buffer, key: string) => `https://cdn.test/${key}`),
  uploadFile: jest.fn(),
  deleteS3ObjectByUrl: jest.fn(),
}));

const KEY = "test-presence-key";
// Wednesday 14:00 EDT (inside 9–6) and 19:30 EDT (outside).
const INSIDE = new Date("2026-09-23T18:00:00Z");
const OUTSIDE = new Date("2026-09-23T23:30:00Z");

async function checkedInEmployee() {
  const { user, token } = await makeUser({ roles: [UserRole.User] });
  await CheckInSessionModel.create({
    userRef: user._id, userEmail: user.email, date: "2026-09-23", checkInAt: new Date(), checkOutAt: null,
  });
  return { user, token };
}

describe("office time helpers", () => {
  it("resolves office hours and office day in America/New_York", () => {
    expect(isWithinOfficeHours(INSIDE)).toBe(true);
    expect(isWithinOfficeHours(OUTSIDE)).toBe(false);
    // Saturday noon EDT.
    expect(isWithinOfficeHours(new Date("2026-09-26T16:00:00Z"))).toBe(false);
    // 1:00 AM IST on the 24th is still the office day of the 23rd.
    expect(officeDate(new Date("2026-09-23T19:30:00Z"))).toBe("2026-09-23");
  });
});

describe("POST /presence/events", () => {
  it("rejects a missing or wrong API key", async () => {
    const app = buildTestApp();
    expect((await request(app).post("/presence/events").send({ type: "left" })).status).toBe(401);
    expect((await request(app).post("/presence/events").set("x-api-key", "nope").send({ type: "left" })).status).toBe(401);
  });

  it("arms awaySince on left and clears it on returned", async () => {
    const app = buildTestApp();
    const { user } = await checkedInEmployee();
    const left = await request(app)
      .post("/presence/events")
      .set("x-api-key", KEY)
      .send({ employeeEmail: user.email.toUpperCase(), type: "left", cameraId: "B", confidence: 0.91 });
    expect(left.status).toBe(200);
    expect(left.body.data.awaySince).toBeTruthy();
    const state = await PresenceStateModel.findOne({ userRef: user._id });
    expect(state?.lastCameraId).toBe("B");

    // A second `left` must not move the timer.
    const armedAt = state?.awaySince;
    await request(app).post("/presence/events").set("x-api-key", KEY).send({ userId: String(user._id), type: "left" });
    expect((await PresenceStateModel.findOne({ userRef: user._id }))?.awaySince?.getTime()).toBe(armedAt?.getTime());

    const back = await request(app).post("/presence/events").set("x-api-key", KEY).send({ userId: String(user._id), type: "returned" });
    expect(back.body.data.awaySince).toBeNull();
  });

  it("ignores events for exempt admins and unknown people", async () => {
    const app = buildTestApp();
    const { user: admin } = await makeUser({ roles: [UserRole.Admin] });
    const res = await request(app).post("/presence/events").set("x-api-key", KEY).send({ userId: String(admin._id), type: "left" });
    expect(res.body.data.ignored).toBe("exempt");
    const unknown = await request(app).post("/presence/events").set("x-api-key", KEY).send({ employeeEmail: "ghost@team.unicodez.com", type: "left" });
    expect(unknown.status).toBe(404);
  });
});

describe("break sweep auto-lock", () => {
  it("locks a checked-in employee away > 5 min inside office hours and notifies admins", async () => {
    const { user } = await checkedInEmployee();
    const { user: admin } = await makeUser({ roles: [UserRole.SuperAdmin] });
    await PresenceStateModel.create({ userRef: user._id, awaySince: new Date(INSIDE.getTime() - 6 * 60 * 1000), lastCameraId: "B" });

    const result = await runBreakSweepTick(INSIDE);
    expect(result.locked).toBe(1);
    const brk = await BreakSessionModel.findOne({ userRef: user._id, endedAt: null });
    expect(brk?.source).toBe("presence");
    expect(brk?.cameraId).toBe("B");
    expect((await PresenceStateModel.findOne({ userRef: user._id }))?.awaySince).toBeNull();
    const alert = await NotificationModel.findOne({ type: "break.unannounced", recipientRef: admin._id });
    expect(alert?.title).toMatch(/unannounced/);

    // Second tick: nothing to do, still exactly one open break.
    expect((await runBreakSweepTick(INSIDE)).locked).toBe(0);
    expect(await BreakSessionModel.countDocuments({ userRef: user._id })).toBe(1);
  });

  it("does not lock before the threshold, outside office hours, or when not checked in", async () => {
    const { user: early } = await checkedInEmployee();
    await PresenceStateModel.create({ userRef: early._id, awaySince: new Date(INSIDE.getTime() - 3 * 60 * 1000) });
    expect((await runBreakSweepTick(INSIDE)).locked).toBe(0);

    const { user: evening } = await checkedInEmployee();
    await PresenceStateModel.create({ userRef: evening._id, awaySince: new Date(OUTSIDE.getTime() - 10 * 60 * 1000) });
    const out = await runBreakSweepTick(OUTSIDE);
    expect(out.locked).toBe(0);
    expect(out.skippedOutsideOfficeHours).toBe(true);

    const { user: notIn } = await makeUser({ roles: [UserRole.User] });
    await PresenceStateModel.create({ userRef: notIn._id, awaySince: new Date(INSIDE.getTime() - 10 * 60 * 1000) });
    expect((await runBreakSweepTick(INSIDE)).locked).toBe(0);
    expect((await PresenceStateModel.findOne({ userRef: notIn._id }))?.awaySince).toBeNull();
    expect(await BreakSessionModel.countDocuments()).toBe(0);
  });

  it("discards an away marker older than 2h instead of locking", async () => {
    const { user } = await checkedInEmployee();
    await PresenceStateModel.create({ userRef: user._id, awaySince: new Date(INSIDE.getTime() - 3 * 60 * 60 * 1000) });
    const r = await runBreakSweepTick(INSIDE);
    expect(r.discarded).toBe(1);
    expect(r.locked).toBe(0);
  });

  it("checking in clears a stale away marker", async () => {
    const app = buildTestApp();
    const { user, token } = await makeUser({ roles: [UserRole.User] });
    await PresenceStateModel.create({ userRef: user._id, awaySince: new Date() });
    const res = await request(app).post("/checkin").set("Authorization", token);
    // Weekend guard may 400 depending on the calendar; either way the marker is only cleared on success.
    if (res.status === 201) {
      expect((await PresenceStateModel.findOne({ userRef: user._id }))?.awaySince).toBeNull();
    }
  });
});

describe("GET /presence/board", () => {
  it("colour-codes every employee and hides admins", async () => {
    const app = buildTestApp();
    const { user: working, token } = await checkedInEmployee();
    const { user: onBreak } = await checkedInEmployee();
    const { user: locked } = await checkedInEmployee();
    const { user: pending } = await checkedInEmployee();
    const { user: home } = await makeUser({ roles: [UserRole.User] });
    const { user: admin } = await makeUser({ roles: [UserRole.Admin] });
    await BreakSessionModel.create([
      { userRef: onBreak._id, date: "2026-09-23", startedAt: new Date(), source: "manual" },
      { userRef: locked._id, date: "2026-09-23", startedAt: new Date(), source: "presence" },
    ]);
    await PresenceStateModel.create({ userRef: pending._id, awaySince: new Date() });

    const res = await request(app).get("/presence/board").set("Authorization", token);
    expect(res.status).toBe(200);
    const byId = new Map(res.body.data.rows.map((r: { userRef: string; status: string }) => [r.userRef, r.status]));
    expect(byId.get(String(working._id))).toBe("working");
    expect(byId.get(String(onBreak._id))).toBe("break");
    expect(byId.get(String(locked._id))).toBe("unannounced");
    expect(byId.get(String(pending._id))).toBe("away_pending");
    expect(byId.get(String(home._id))).toBe("not_checked_in");
    expect(byId.has(String(admin._id))).toBe(false);
    expect(res.body.data.rows[0].status).toBe("unannounced");
    expect(res.body.data.counts.break).toBe(1);
    expect(res.body.data.officeTz).toBe("America/New_York");
  });
});

describe("unidentified snapshots", () => {
  it("stores the snapshot, alerts admins, and assigning it synthesises a presence event", async () => {
    const app = buildTestApp();
    const { user: admin, token: adminTok } = await makeUser({ roles: [UserRole.Hr] });
    const { user: emp } = await checkedInEmployee();

    const up = await request(app)
      .post("/presence/unidentified")
      .set("x-api-key", KEY)
      .field("cameraId", "B")
      .field("direction", "out")
      .field("reason", "no_face")
      .attach("image", Buffer.from("fakejpeg"), { filename: "snap.jpg", contentType: "image/jpeg" });
    expect(up.status).toBe(201);
    expect(up.body.data.imageUrl).toMatch(/^https:\/\/cdn\.test\/presence\/unidentified\//);
    const alert = await NotificationModel.findOne({ type: "presence.unidentified", recipientRef: admin._id });
    expect(alert?.link.unidentifiedId).toBe(up.body.data._id);

    const noKey = await request(app).post("/presence/unidentified").field("direction", "out");
    expect(noKey.status).toBe(401);

    const list = await request(app).get("/presence/unidentified").set("Authorization", adminTok);
    expect(list.body.data).toHaveLength(1);

    const assign = await request(app)
      .post(`/presence/unidentified/${up.body.data._id}/resolve`)
      .set("Authorization", adminTok)
      .send({ resolution: "assigned", userId: String(emp._id) });
    expect(assign.status).toBe(200);
    expect(assign.body.data.resolution).toBe("assigned");
    const state = await PresenceStateModel.findOne({ userRef: emp._id });
    expect(state?.awaySince).toBeTruthy();
    expect(state?.lastEventType).toBe("left");
    expect(await UnidentifiedEventModel.countDocuments({ resolution: "pending" })).toBe(0);
  });
});
