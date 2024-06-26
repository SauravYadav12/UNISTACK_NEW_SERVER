const passport = require("passport");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const jwtDecode = require("jwt-decode");

// Signup funtion
exports.signup = (req, res, next) => {
  try {
    let newUser = new User({
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      password: req.body.password,
      corpName: req.body.corpName || "Unicodez",
    });

    User.addUser(newUser, (err, user) => {
      if (err) {
        res.status(400).json({
          message: "Failed to create User Or User Already exists.",
          error: err,
        });
      } else {
        res.status(200).json({
          message: "User Registration successful",
          user: user,
        });
      }
    });
  } catch (error) {}
};

// Login funtion
exports.login = async (req, res, next) => {
  User.getUserByEmail(req.body.email, (err, user) => {
    if (err) throw err;

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User Not found",
      });
    }

    User.comparePassword(req.body.password, user.password, (err, isMatch) => {
      if (err) throw err;

      if (isMatch) {
        if (user.active) {
          const token = jwt.sign({ user }, process.env.JWT_SECRET_KEY, {
            expiresIn: 604800, // 1 week
          });
          res.status(200).json({
            token: "JWT " + token,
            user: {
              id: user._id,
              firstName: user.firstName,
              lastName: user.lastName,
              corpName: user.corpName,
              email: user.email,
              premium: user.premium,
              role: user.role,
              active: user.active
            }
          });
        } else {
          res.status(400).json({
            message: "User is not active!",
          });
        }
      } else {
        return res.status(400).json({
          success: false,
          message: "Invalid Password",
        });
      }
    });
  });
};

// Dashboard funtion
exports.dashboard = async (req, res, next) => {
  // console.log(req.headers);
  res.json({
    status: "Success",
    user: req.user,
  });
};

// Validate funtion

exports.validate = (req, res, next) => {
  // 1) Get the token and check if it exist

  if (req.headers.authorization) {
    let value = req.headers.authorization;
    let [jwt, newToken] = value.split(" ");
    // console.log(jwt);
    // const token = newToken;
    const decoded = jwtDecode(newToken);
    //The User is Logged in.
    res.json({
      authenticated: true,
      username: decoded.user.name,
    });
  } else {
    res.json({
      authenticated: false,
      username: null,
    });
  }
};
