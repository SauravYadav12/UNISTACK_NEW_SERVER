const express = require("express");
const router = express.Router();
const passport = require("passport");
const { getAllInterviews, createInterview, updateInterview, deleteInterview } = require("../controllers/vendor-interview");


router.get("/get-interviews", passport.authenticate("jwt", { session: false }),  getAllInterviews)

router.post("/create-interview", passport.authenticate("jwt", { session: false }), createInterview)

router.patch("/update-interview/:id", passport.authenticate("jwt", { session: false }), updateInterview)

router.delete("/delete-interview/:id", passport.authenticate("jwt", { session: false }), deleteInterview)


module.exports = router;