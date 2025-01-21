const express = require("express");
const router = express.Router();
const passport = require("passport");
const { getAllTeams, createTeam, updateTeam, deleteTeam } = require("../controllers/team");

router.get("/get-teams", passport.authenticate("jwt", { session: false }), getAllTeams)

router.post("/create-team", passport.authenticate("jwt", { session: false }), createTeam)

router.patch("/update-team/:id", passport.authenticate("jwt", { session: false }), updateTeam)

router.delete("/delete-team/:id", passport.authenticate("jwt", { session: false }), deleteTeam)

module.exports = router;