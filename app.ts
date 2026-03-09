import express from "express";
import path from "path";
import cors from "cors";
import passport from "passport";
import mongoose from "mongoose";
import dotenv from "dotenv";
dotenv.config({ path: "./config.env" });
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
import initPassport from "./config/passport";
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
  process.env.DATABASE?.replace(
    "<PASSWORD>",
    process.env.DATABASE_PASSWORD || ""
  ) || "";

mongoose
  .connect(DB, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useFindAndModify: false,
    useUnifiedTopology: true,
  })
  .then(() => console.log("Dev DB Connections successfull")).catch((err) => {
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

//PORT
const port = process.env.PORT || 5000;

//Index Route
app.get("/", (req, res) => {
  res.send("Invalid Endpoint");
});

//Start Server
app.listen(port, () => {
  console.log(`App running on port ${port}... `);
});
