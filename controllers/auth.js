const passport = require("passport");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const jwtDecode = require("jwt-decode");
const randomString = require("randomstring");
const bcrypt = require("bcryptjs");
const {
  mailTransporter,
  optHTMLTemplate,
} = require("../utils/mailTransporter");

// Signup funtion
exports.signup = (req, res, next) => {
  try {
    let newUser = new User({
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      password: req.body.password,
      corpName: req.body.corpName || "Unicodez",
      gender: req.body.gender,
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
exports.addLogoutActivity = async (req, res) => {
  try {
    const { ip, location, _id } = req.body;
    const activity = {
      loggedOutAt: new Date(),
      ip,
      location,
    };
    await User.findByIdAndUpdate(_id, { $push: { activity } }, { new: true });
    res.status(200).json({ status: "success" });
  } catch (error) {
    res.status(400).json({ status: "failed" });
  }
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

    User.comparePassword(
      req.body.password,
      user.password,
      async (err, isMatch) => {
        if (err) throw err;

        if (isMatch) {
          if (user.active) {
            const { ip, location } = req.body;
            const activity = {
              loggedInAt: new Date(),
              ip,
              location,
            };
            await User.findByIdAndUpdate(
              user._id,
              {
                $push: { activity },
              },
              { new: true }
            );
            const iUser = {
              _id: user._id,
              id: user._id,
              firstName: user.firstName,
              lastName: user.lastName,
              corpName: user.corpName,
              email: user.email,
              premium: user.premium,
              role: user.role,
              active: user.active,
              gender: user.gender,
              shift: user.shift,
            };
            const token = jwt.sign(
              { user: iUser },
              process.env.JWT_SECRET_KEY,
              {
                expiresIn: "10h",
              }
            );
            res.status(200).json({
              token: "JWT " + token,
              user: iUser,
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
      }
    );
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

exports.resetPassword = async (req, res) => {
  const { otp } = req.params;
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ message: "Passwords is required." });
  }

  try {
    const user = await User.findOne({
      resetPasswordOtp: otp,
      resetPasswordOtpExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired otp." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    user.password = hashedPassword;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    return res
      .status(200)
      .json({ message: "Password reset successfull", status: true });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

exports.verifyOtp = async (req, res) => {
  const { otp } = req.params;

  try {
    const user = await User.findOne({
      resetPasswordOtp: otp,
      resetPasswordOtpExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid or expired otp.",
        error: "Invalid or expired otp.",
      });
    }

    return res
      .status(200)
      .json({ message: "verification successfull.", status: true });
  } catch (error) {
    return res.status(500).json({ message: "Internal server error." });
  }
};

exports.sendOtpToResetPassword = async (req, res) => {
  const { email } = req.params;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({
        message: "User with this email not found.",
        error: "Not found",
      });
    }

    const otp = randomString.generate({
      length: 6,
      charset: "numeric",
      readable: true,
    });

    user.resetPasswordOtp = otp;
    user.resetPasswordOtpExpires = Date.now() + 1000 * 60 * 10;

    await user.save();

    const mailOptions = {
      from: "info@unicodez.com",
      to: user.email,
      subject: "One time password",
      html: optHTMLTemplate(otp),
    };

    mailTransporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.log("Transporter error", error);
        return res.status(500).json({ message: "Failed to send email." });
      }
      return res
        .status(200)
        .json({ message: "One time password sent successfully." });
    });
  } catch (error) {
    console.error("Send email error:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};
