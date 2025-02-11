const express = require("express");
const passport = require("passport");
const auth = require('../controllers/auth');
const { getAllUsers, updateUser } = require("../controllers/user-management");
const router = express.Router();

// Get routes
router.get("/validate", auth.validate);
router.get("/dashboard", passport.authenticate("jwt", { session: false }), auth.dashboard);
//

//Post Routes
router.post("/signup", auth.signup);
router.post("/login", auth.login);
router.post("/logout", auth.addLogoutActivity);

//User Management
router.get("/list", passport.authenticate("jwt", { session: false }), getAllUsers);
router.patch("/:id", passport.authenticate("jwt", {session: false}), updateUser);
module.exports = router;
