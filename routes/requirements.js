const express = require("express");
const { getAllRrequirements, createRequirement, updateRequirement, deleteRequirement } = require("../controllers/requirement");
const router = express.Router();
const passport = require("passport");


router.get("/get-requirements", passport.authenticate("jwt", { session: false }), getAllRrequirements)

router.post("/create-requirement", passport.authenticate("jwt", { session: false }), createRequirement)

router.patch("/update-requirement/:id", passport.authenticate("jwt", {session: false}), updateRequirement);

router.delete("/delete-requirement/:id", passport.authenticate("jwt", {session: false}), deleteRequirement)

module.exports = router;