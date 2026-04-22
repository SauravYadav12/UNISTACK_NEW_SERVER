import jwt from "jsonwebtoken";
import {
  addUser,
  comparePassword,
  getUserByEmail,
  UserDoc,
  UserModel,
} from "../models/userModel";
import jwtDecode from "jwt-decode";
import randomString from "randomstring";
import bcrypt from "bcryptjs";
import {
  loginOtpTemplate,
  otpExpiryInMs,
  resetPasswordOtpTemplate,
  sendMail,
} from "../utils/mailTransporter";
import { Request, Response } from "express";
import ENV_VARS from "../config/env.config";
import { UserRole } from "../enums/UserEnum";

export function extractIUser(user: UserDoc) {
  return {
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
    workLocation: user.workLocation,
    canEdit: user.canEdit,
  };
}

// Signup funtion
export const signup = (req: Request, res: Response) => {
  try {
    const newUser = new UserModel({
      firstName: req.body.firstName,
      lastName: req.body.lastName,
      email: req.body.email,
      password: req.body.password,
      corpName: req.body.corpName || "Unicodez",
      gender: req.body.gender,
    });

    addUser(newUser, (err, user) => {
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
  } catch (error) {
    console.log(error);
    res.status(500).json({
      message: "Internal server error",
      error,
    });
  }
};
export const addLogoutActivity = async (req: Request, res: Response) => {
  try {
    const { ip, location, _id } = req.body;
    const activity = {
      loggedOutAt: new Date(),
      ip,
      location,
    };
    await UserModel.findByIdAndUpdate(
      _id,
      { $push: { activity } },
      { new: true },
    );
    res.status(200).json({ status: "success" });
  } catch (error) {
    console.log(error);
    res.status(400).json({ status: "failed" });
  }
};
// Login funtion
export const login = async (req: Request, res: Response) => {
  getUserByEmail(req.body.email, (err, user) => {
    if (err) throw err;

    if (!user) {
      return res.status(400).json({
        success: false,
        message: "User Not found",
      });
    }

    comparePassword(req.body.password, user.password, async (err, isMatch) => {
      if (err) throw err;

      if (isMatch) {
        if (user.active) {
          const { ip, location } = req.body;
          const activity = {
            loggedInAt: new Date(),
            ip,
            location,
          };
          await UserModel.findByIdAndUpdate(
            user._id,
            {
              $push: { activity },
            },
            { new: true },
          );
          const iUser = extractIUser(user);

          const skipOtp =
            Array.isArray(user.role) &&
            (user.role.includes(UserRole.SuperAdmin) ||
              user.role.includes(UserRole.Admin));

          if (skipOtp) {
            const token = jwt.sign(
              { user: iUser },
              ENV_VARS.JWT_SECRET_KEY || "unistack",
              { expiresIn: "10h" },
            );
            res.status(200).json({
              user: iUser,
              token: "JWT " + token,
            });
          } else {
            res.status(200).json({
              user: iUser,
            });
          }
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
export const syncIUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const iUser = await UserModel.findOne({ _id: id.toString() });
    if (!iUser) {
      res.status(400).json({
        status: "failed",
        error: "User not found",
      });

      return;
    }
    const user = extractIUser(iUser);
    res.status(200).json({
      status: "success",
      user,
    });
  } catch (error) {
    res.status(400).json({
      status: "failed",
      error,
    });
  }
};
// Dashboard funtion
export const dashboard = async (req: Request, res: Response) => {
  // console.log(req.headers);
  res.json({
    status: "Success",
    user: req.user,
  });
};

// Validate funtion

export const validate = (req: Request, res: Response) => {
  if (req.headers.authorization) {
    const value = req.headers.authorization;
    const [, newToken] = value.split(" ");

    const decoded = jwtDecode<{ user: { name: string } }>(newToken);
    res.json({
      authenticated: true,
      username: decoded?.user?.name,
    });
  } else {
    res.json({
      authenticated: false,
      username: null,
    });
  }
};

export const resetPassword = async (req: Request, res: Response) => {
  const { otp, email } = req.params;
  const { password } = req.body;

  if (!password) {
    res.status(400).json({ message: "Passwords is required." });
    return;
  }

  if(typeof email !== "string" || typeof otp !== "string") {
    res.status(400).json({ message: "Invalid email or otp." });
    return;
  }

  try {
    const user = await UserModel.findOne({
      email,
      otp,
      otpExpiry: { $gt: new Date() },
    });

    if (!user) {
      res.status(400).json({ message: "Invalid or expired otp." });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    user.password = hashedPassword;
    // user.resetPasswordToken = undefined;
    // user.resetPasswordExpires = undefined;
    await user.save();
    res
      .status(200)
      .json({ message: "Password reset successfull", status: true });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Internal server error." });
  }
};

export const verifyOtp = async (req: Request, res: Response) => {
  const { otp, email } = req.params;


  if(typeof email !== "string" || typeof otp !== "string") {
    res.status(400).json({ message: "Invalid email or otp." });
    return;
  }

  try {
    const user = await UserModel.findOne({
      email,
      otp: otp,
      otpExpiry: { $gt: new Date() },
    });

    if (!user) {
      res.status(400).json({
        message: "Invalid or expired otp.",
        error: "Invalid or expired otp.",
      });
      return;
    }

    const iUser = extractIUser(user);
    const token = jwt.sign(
      { user: iUser },
      ENV_VARS.JWT_SECRET_KEY || "unistack",
      {
        expiresIn: "10h",
      },
    );

    res.status(200).json({
      token: "JWT " + token,
      message: "verification successfull.",
      status: true,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Internal server error." });
  }
};

const generateAndStoreOTP = async (email: string) => {
  const user = await UserModel.findOne({ email });
  if (!user) {
    return { error: "User not found." };
  }

  const otp = randomString.generate({
    length: 6,
    charset: "numeric",
    readable: true,
  });

  const now = Date.now();
  user.otp = otp;
  user.otpExpiry = new Date(now + otpExpiryInMs);

  await user.save();
  return { otp };
};

export const sendOtpToResetPassword = async (req: Request, res: Response) => {
  const { email } = req.params;

  try {
    const { error, otp } = await generateAndStoreOTP(email.toString());
    if (error || !otp) {
      res.status(404).json({
        message: "User with this email not found.",
        error: "User not found",
      });
      return;
    }
    const mailOptions = {
      from: ENV_VARS.COMPANY_EMAIL,
      to: email,
      subject: "One time password",
      html: resetPasswordOtpTemplate(otp),
    };

    await sendMail(mailOptions);
    res.status(200).json({ message: "One time password sent successfully." });
  } catch (error) {
    console.error("Send email error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};
export const sendOtpToLogin = async (req: Request, res: Response) => {
  const { email } = req.params;

  try {
    const { error, otp } = await generateAndStoreOTP(email.toString());
    if (error || !otp) {
      res.status(404).json({
        message: "User with this email not found.",
        error: "Not found",
      });
      return;
    }
    const mailOptions = {
      from: ENV_VARS.COMPANY_EMAIL,
      to: email,
      subject: "One time password",
      html: loginOtpTemplate(otp),
    };

    await sendMail(mailOptions);
    res.status(200).json({ message: "One time password sent successfully." });
  } catch (error) {
    console.error("Send email error:", error);
    res.status(500).json({ message: "Internal server error." });
  }
};
