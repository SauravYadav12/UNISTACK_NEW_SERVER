import { Router } from "express";
import PayslipController from "../controllers/payslipController";
import passport from "passport";

const payslipRouter = Router();

payslipRouter.post(
  "/",
  passport.authenticate("jwt", { session: false }),
  PayslipController.create,
);
payslipRouter.get(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  PayslipController.getPayslipById,
);
payslipRouter.get(
  "/",
  passport.authenticate("jwt", { session: false }),
  PayslipController.list,
);


export default payslipRouter;