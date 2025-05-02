import express from "express";
const consultantRoute = express.Router();
import passport from "passport";
import {
  getAllConsultants,
  createConsultant,
  updateConsultant,
  deleteConsultant,
} from "../controllers/consultantController";

consultantRoute.get(
  "/get-consultants",
  passport.authenticate("jwt", { session: false }),
  getAllConsultants
);

consultantRoute.post(
  "/create-consultant",
  passport.authenticate("jwt", { session: false }),
  createConsultant
);

consultantRoute.patch(
  "/update-consultant/:id",
  passport.authenticate("jwt", { session: false }),
  updateConsultant
);

consultantRoute.delete(
  "/delete-consultant/:id",
  passport.authenticate("jwt", { session: false }),
  deleteConsultant
);

export { consultantRoute };
