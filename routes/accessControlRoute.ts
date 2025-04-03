import { Router } from "express";
import passport from "passport";
import {
  getAccessControl,
  updateAccessControl,
} from "../controllers/accessControlController";

const accessControlRoute = Router();

accessControlRoute.get(
  "/",
  passport.authenticate("jwt", { session: false }),
  getAccessControl
);

accessControlRoute.patch(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  updateAccessControl
);

export { accessControlRoute };
