import { Router } from "express";
import passport from "passport";
import {
  createUserProfile,
  deleteUserProfileById,
  getUserProfileById,
  getUserProfiles,
  updateUserProfileById,
} from "../controllers/userProfileController";

const userProfileRoutes = Router();
userProfileRoutes.post(
  "/",
  passport.authenticate("jwt", { session: false }),
  createUserProfile
);
userProfileRoutes.put(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  updateUserProfileById
);
userProfileRoutes.get(
  "/",
  passport.authenticate("jwt", { session: false }),
  getUserProfiles
);
userProfileRoutes.get(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  getUserProfileById
);
userProfileRoutes.delete(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  deleteUserProfileById
);

export { userProfileRoutes };
