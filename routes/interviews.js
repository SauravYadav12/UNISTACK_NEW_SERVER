const express = require("express");
const router = express.Router();
const passport = require("passport");
const { getAllInterviews, createInterview } = require("../controllers/interview");


router.get("/get-interviews", passport.authenticate("jwt", { session: false }), getAllInterviews)

router.post("/create-interview", passport.authenticate("jwt", { session: false }), createInterview)


module.exports = router;