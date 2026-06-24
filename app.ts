import express from "express";
import path from "path";
import cors from "cors";
import dns from "dns";
import passport from "passport";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config();

// Pin Node's DNS resolver to Google + Cloudflare. The DigitalOcean managed
// MongoDB connection string is `mongodb+srv://...`, which requires an SRV
// record lookup before the driver can dial any host. On some machines the
// macOS `scutil --dns` order has a VPN-injected or captive-portal resolver
// listed first that refuses SRV queries — Node hits that one and the boot
// crashes with `querySrv EREFUSED` even though `dig` (which uses the ISP
// DNS directly) gets a clean answer. Overriding here makes the resolver
// behaviour deterministic across machines.
dns.setServers(["8.8.8.8", "1.1.1.1", "8.8.4.4"]);
import { usersRoute } from "./routes/usersRoute";
import { requirementRoute } from "./routes/requirementsRoute";
import { interviewRoute } from "./routes/interviewsRoute";
import { vendorsRoute } from "./routes/vendorsRoute";
import { consultantRoute } from "./routes/consultantsRoute";
import { userProfileRoute } from "./routes/userProfileRoute";
import { storageRoute } from "./routes/storageRoute";
import { teamsRoute } from "./routes/teamsRoute";
import { salesLeadRoute } from "./routes/salesLeadRoute";
import { reportRoute } from "./routes/reportRoute";
import { archiveRoute } from "./routes/archivesRoute";
import { attendanceRoute } from "./routes/attendanceRoute";
import { accessControlRoute } from "./routes/accessControlRoute";
import { leaveRoute } from "./routes/leaveRoute";
import morgan from "morgan";
import { holidayRoute } from "./routes/holidayRoutes";
import { salaryRoute } from "./routes/salaryRoute";
import { holidayNoticeRoute } from "./routes/holidayNoticeRoute";
import { initHolidayNoticeScheduler } from "./services/holidayNoticeScheduler";
import { leaveTypeRoute, leaveBalanceRoute } from "./routes/leaveTypeRoute";
import { projectRoute } from "./routes/projectsRoute";
import { organizationRoute } from "./routes/organizationRoute";
import { timesheetRoute } from "./routes/timesheetRoute";
import { timesheetApprovalRoute } from "./routes/timesheetApprovalRoute";
import { invoiceRoute } from "./routes/invoiceRoute";
import { invoiceEmailSettingsRoute } from "./routes/invoiceEmailSettingsRoute";
import { performanceRoute } from "./routes/performanceRoute";
import { notificationRoute } from "./routes/notificationRoute";
import { jobBoardRoute } from "./routes/jobBoardRoutes";
import { probationRoute } from "./routes/probationRoute";
import { onboardingRoute } from "./routes/onboardingRoute";
import { publicOnboardingRoute } from "./routes/publicOnboardingRoute";
import { myDocumentsRoute } from "./routes/myDocumentsRoute";
import { form16Route } from "./routes/form16Route";
import { initInvoiceDueScheduler } from "./services/invoiceDueScheduler";
import { initLeaveBalanceSystem } from "./services/leaveBalanceScheduler";
import { initPerformanceWarningScheduler } from "./services/performanceWarningScheduler";
import { initInterviewReminderScheduler } from "./services/interviewReminderScheduler";
import { startProbationNotificationScheduler } from "./services/probationNotificationScheduler";
import initPassport from "./config/passport";
import ENV_VARS from "./config/env.config";
const app = express();
app.use(morgan("dev"));
//Body Parser
app.use(express.json());
//CORS Middleware
app.use(cors());
//Passport Middleware
app.use(passport.initialize());
app.use(passport.session());
initPassport(passport);

//Set Static folder
app.use(express.static(path.join(__dirname, "public")));

//Database Setup
const DB =
  ENV_VARS.DATABASE?.replace(
    "<PASSWORD>",
    ENV_VARS.DATABASE_PASSWORD || ""
  ) || "";

mongoose
  .connect(DB, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useFindAndModify: false,
    useUnifiedTopology: true,
  })
  .then(() => {
    console.log("Dev DB Connections successfull");
    initLeaveBalanceSystem();
    initHolidayNoticeScheduler();
    initInvoiceDueScheduler();
    initPerformanceWarningScheduler();
    initInterviewReminderScheduler();
    startProbationNotificationScheduler();
  }).catch((err) => {
    console.error("DB connection error:", err);
  });

//User Routes
app.use("/users", usersRoute);
app.use("/requirements", requirementRoute);
app.use("/interviews", interviewRoute);
app.use("/vendors", vendorsRoute);
app.use("/consultants", consultantRoute);
app.use("/user-profiles", userProfileRoute);
app.use("/storage", storageRoute);
app.use("/sales-leads", salesLeadRoute);
app.use("/teams", teamsRoute);
app.use("/reports", reportRoute);
app.use("/archives", archiveRoute);
app.use("/attendance", attendanceRoute);
app.use("/access-control", accessControlRoute);
app.use("/leaves", leaveRoute);
app.use("/holidays", holidayRoute);
app.use("/salary", salaryRoute);
app.use("/holiday-notice", holidayNoticeRoute);
app.use("/leave-types", leaveTypeRoute);
app.use("/leave-balances", leaveBalanceRoute);
app.use("/projects", projectRoute);
app.use("/organizations", organizationRoute);
app.use("/timesheets", timesheetRoute);
app.use("/timesheet-approvals", timesheetApprovalRoute);
app.use("/invoices", invoiceRoute);
app.use("/invoice-email-settings", invoiceEmailSettingsRoute);
app.use("/performance", performanceRoute);
app.use("/notifications", notificationRoute);
app.use("/job-search", jobBoardRoute);
app.use("/probation", probationRoute);
app.use("/onboarding", onboardingRoute);
// Public, no-auth onboarding surface — token in URL is the credential.
app.use("/p/onboarding", publicOnboardingRoute);
// Employee-facing personal documents — JWT-gated, scoped per-user
// inside each controller. Currently surfaces signed onboarding docs.
app.use("/my-documents", myDocumentsRoute);
// Form-16 admin module (super-admin-only inside the route file).
app.use("/form16", form16Route);

// Surface a clear boot-time warning if the Job Boards feature is wired
// up but the upstream key is missing. Without this, the first search
// would just 503 with no explanation in the deploy logs.
if (!process.env.JSEARCH_RAPIDAPI_KEY) {
  console.warn(
    "[job-search] JSEARCH_RAPIDAPI_KEY is not set. " +
      "Job Boards searches will fail with a 503 until it is added to .env. " +
      "Sign up at https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch and subscribe to a tier.",
  );
}

//PORT
const port = ENV_VARS.PORT || 5000;

//Index Route
app.get("/", (req, res) => {
  res.send("Invalid Endpoint");
});

//Start Server
app.listen(port, () => {
  console.log(`App running on port ${port}... `);
});
