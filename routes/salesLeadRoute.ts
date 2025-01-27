import { Router } from "express";

import passport from "passport";
import {
  createSalesLead,
  deleteSalesLead,
  getSalesLeadsById,
  getSalesLeads,
  updateSalesLead,
  createComment,updateComment,
  deleteComment,
} from "../controllers/salesLeadController";
const salesLeadRoute = Router();

salesLeadRoute.post("/", createSalesLead);
salesLeadRoute.patch(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  updateSalesLead
);
salesLeadRoute.get(
  "/",
  passport.authenticate("jwt", { session: false }),
  getSalesLeads
);
salesLeadRoute.get(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  getSalesLeadsById
);
salesLeadRoute.delete(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  deleteSalesLead
);
salesLeadRoute.post(
  "/:salesLeadId/comments",
  passport.authenticate("jwt", { session: false }),
  createComment
);
salesLeadRoute.patch(
  "/:salesLeadId/comments/:commentId",
  passport.authenticate("jwt", { session: false }),
  updateComment
);
salesLeadRoute.delete(
  "/:salesLeadId/comments/:commentId",
  passport.authenticate("jwt", { session: false }),
  deleteComment
);

export { salesLeadRoute };
