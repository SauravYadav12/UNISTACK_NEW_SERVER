const express = require("express");
const router = express.Router();
const passport = require("passport");
const { getAllConsultants, createConsultant, updateConsultant, deleteConsultant } = require("../controllers/consultant");


router.get("/get-consultants", passport.authenticate("jwt", { session: false }),  getAllConsultants)

router.post("/create-consultant", passport.authenticate("jwt", { session: false }), createConsultant )

router.patch("/update-consultant/:id", passport.authenticate("jwt", { session: false }), updateConsultant)

router.delete("/delete-consultant/:id", passport.authenticate("jwt", { session: false }), deleteConsultant)


module.exports = router;