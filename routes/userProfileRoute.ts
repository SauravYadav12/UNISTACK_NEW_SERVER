import { Router } from "express";
import passport from "passport";
import {
  createUserProfile,
  deleteUserProfileById,
  getUserProfileById,
  getUserProfiles,
  updateUserProfileById,
} from "../controllers/userProfileController";

const userProfileRoute = Router();
userProfileRoute.post(
  "/",
  passport.authenticate("jwt", { session: false }),
  createUserProfile
);
userProfileRoute.put(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  updateUserProfileById
);
userProfileRoute.get(
  "/",
  passport.authenticate("jwt", { session: false }),
  getUserProfiles
);
userProfileRoute.get(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  getUserProfileById
);
userProfileRoute.delete(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  deleteUserProfileById
);

export { userProfileRoute };
