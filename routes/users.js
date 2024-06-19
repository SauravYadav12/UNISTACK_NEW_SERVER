const express = require("express");
const passport = require("passport");
const auth = require('../controllers/auth');
const router = express.Router();

// Get routes
// router.get('/signup', auth.signup);
// router.get('/login', auth.login);
router.get('/validate', auth.validate);
router.get('/dashboard' , passport.authenticate('jwt',{session:false}), auth.dashboard);
//

//Post Routes
router.post('/signup', auth.signup);
router.post('/login', auth.login);

module.exports = router;