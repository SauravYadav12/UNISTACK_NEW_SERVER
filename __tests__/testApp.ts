import express from "express";
import passport from "passport";
import jwt from "jsonwebtoken";
import initPassport from "../config/passport";
import { UserModel, UserDoc } from "../models/userModel";
import { UserRole } from "../enums/UserEnum";

import { organizationRoute } from "../routes/organizationRoute";
import { projectRoute } from "../routes/projectsRoute";
import { timesheetRoute } from "../routes/timesheetRoute";
import { timesheetApprovalRoute } from "../routes/timesheetApprovalRoute";
import { invoiceRoute } from "../routes/invoiceRoute";
import { invoiceEmailSettingsRoute } from "../routes/invoiceEmailSettingsRoute";

let cached: express.Express | null = null;

/**
 * Build a minimal Express app that mounts just the billing-module routes for
 * integration tests. We skip the real db connect + schedulers — tests/setup.ts
 * owns the mongo connection, and we never want a scheduler firing in a test.
 */
export function buildTestApp(): express.Express {
  if (cached) return cached;
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use(passport.initialize());
  initPassport(passport);

  app.use("/organizations", organizationRoute);
  app.use("/projects", projectRoute);
  app.use("/timesheets", timesheetRoute);
  app.use("/timesheet-approvals", timesheetApprovalRoute);
  app.use("/invoices", invoiceRoute);
  app.use("/invoice-email-settings", invoiceEmailSettingsRoute);

  cached = app;
  return app;
}

/** Seed a user with a specific set of roles and return { user, token }. */
export async function makeUser(opts: {
  roles: UserRole[];
  emailLocal?: string;
  firstName?: string;
  lastName?: string;
  active?: boolean;
}): Promise<{ user: UserDoc; token: string }> {
  const email = `${opts.emailLocal || `u${Date.now()}-${Math.floor(Math.random() * 1e6)}`}@unicodez.com`;
  const user = await UserModel.create({
    firstName: opts.firstName || "Test",
    lastName: opts.lastName || "User",
    email,
    password: "Password123!",
    role: opts.roles,
    active: opts.active ?? true,
    corpName: "Unicodez",
    gender: "other",
  } as Partial<UserDoc>);

  // Matches passport.ts's fallback so signing + verification stay in sync
  // even if the env var slipped through unset.
  const secret = process.env.JWT_SECRET_KEY || "your_jwt_secret_key";
  const payload = {
    user: {
      _id: user._id,
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
    },
  };
  const token = "JWT " + jwt.sign(payload, secret, { expiresIn: "1h" });
  return { user, token };
}
