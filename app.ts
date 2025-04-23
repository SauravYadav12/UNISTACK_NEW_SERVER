import express from "express";
import path from "path";
import cors from "cors";
import passport from "passport";
import mongoose from "mongoose";
import { usersRoute } from "./routes/usersRoute";
import dotenv from "dotenv";
import requirements from "./routes/requirements";
import interviews from "./routes/interviews";
import vendors from "./routes/vendors";
import consultants from "./routes/consultants";
import { userProfileRoute } from "./routes/userProfileRoute";
import { storageRoute } from "./routes/storageRoute";
import teams from "./routes/teams";
import { salesLeadRoute } from "./routes/salesLeadRoute";
import { reportRoute } from "./routes/reportRoute";
import { archiveRoute } from "./routes/archivesRoute";
import { attendanceRoute } from "./routes/attendanceRoute";
import { accessControlRoute } from "./routes/accessControlRoute";
import { leaveRoute } from "./routes/leaveRoute";
dotenv.config({ path: "./config.env" });

const app = express();

//Body Parser
app.use(express.json());
//CORS Middleware
app.use(cors());
//Passport Middleware
app.use(passport.initialize());
app.use(passport.session());
require("./config/passport")(passport);

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
  .then(() => console.log("DB Connections successfull"));

//User Routes
app.use("/users", usersRoute);
app.use("/requirements", requirements);
app.use("/interviews", interviews);
app.use("/vendors", vendors);
app.use("/consultants", consultants);
app.use("/user-profiles", userProfileRoute);
app.use("/storage", storageRoute);
app.use("/sales-leads", salesLeadRoute);
app.use("/teams", teams);
app.use("/reports", reportRoute);
app.use("/archives", archiveRoute);
app.use("/attendance", attendanceRoute);
app.use("/access-control", accessControlRoute);
app.use("/leaves", leaveRoute);

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
