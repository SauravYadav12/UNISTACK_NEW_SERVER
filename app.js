const express = require("express");
const path = require("path");
const cors = require("cors");
const passport = require("passport");
const mongoose = require("mongoose");
const users = require("./routes/users");
const dotenv = require("dotenv");
const requirements = require("./routes/requirements")
const interviews = require("./routes/interviews")
const vendors = require("./routes/vendors")
const consultants = require("./routes/consultants")
const { userProfileRoutes } = require("./routes/userProfileRoutes");
const { storageRoutes } = require("./routes/storageRoutes");
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
const DB = process.env.DATABASE.replace(
  "<PASSWORD>",
  process.env.DATABASE_PASSWORD
);

mongoose
  .connect(DB, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useFindAndModify: false,
    useUnifiedTopology: true,
  })
  .then(() => console.log("DB Connections successfull"));

//User Routes
app.use("/users", users);
app.use("/requirements", requirements);
app.use("/interviews", interviews);
app.use("/vendors", vendors)
app.use("/consultants", consultants)
app.use("/user-profiles", userProfileRoutes);
app.use("/storage", storageRoutes);
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
