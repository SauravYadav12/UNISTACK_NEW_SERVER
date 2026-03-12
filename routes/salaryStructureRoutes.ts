import { Router } from "express";

import { SalaryStructureController } from "../controllers/salaryStructureController";
import passport from "passport";

const salaryStructureRoute = Router();

salaryStructureRoute.post(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  SalaryStructureController.save,
);
salaryStructureRoute.get(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  SalaryStructureController.get,
);
salaryStructureRoute.get(
  "/",
  passport.authenticate("jwt", { session: false }),
  SalaryStructureController.getAll,
);
export { salaryStructureRoute };
