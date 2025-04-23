import express from "express";
import passport from "passport";
import {
  validate,
  dashboard,
  signup,
  login,
  sendOtpToLogin,
  verifyOtp,
  sendOtpToResetPassword,
  resetPassword,
  addLogoutActivity,
} from "../controllers/auth";
import { getAllUsers, updateUser } from "../controllers/user-management";
const usersRoute = express.Router();

// Get routes
usersRoute.get("/validate", validate);
usersRoute.get(
  "/dashboard",
  passport.authenticate("jwt", { session: false }),
  dashboard
);
//

//Post Routes
usersRoute.post("/signup", signup);
usersRoute.post("/login", login);
usersRoute.post("/send-login-otp/:email", sendOtpToLogin);
usersRoute.post("/send-reset-password-otp/:email", sendOtpToResetPassword);
usersRoute.post("/:email/verify-otp/:otp", verifyOtp);
usersRoute.post("/:email/reset-password/:otp", resetPassword);
usersRoute.post("/logout", addLogoutActivity);

//User Management
usersRoute.get(
  "/list",
  passport.authenticate("jwt", { session: false }),
  getAllUsers
);
usersRoute.patch(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  updateUser
);
export { usersRoute };
