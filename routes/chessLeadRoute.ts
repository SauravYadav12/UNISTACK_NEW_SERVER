import express from "express";
import passport from "passport";
import { anyRoleGuard, roleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  createChessLead,
  createChessLeadLog,
  deleteChessLead,
  getChessLeadById,
  getChessLeadLog,
  getChessLeadStats,
  listChessLeads,
  updateChessLead,
} from "../controllers/chessLeadController";

const chessLeadRoute = express.Router();
const jwt = passport.authenticate("jwt", { session: false });

// Everything below is gated to the ChessSales team + SuperAdmin. Order
// of specific-before-parametric routes matters — /stats and /logs must
// come before /:id or the :id param would swallow them.
const anySalesOrAdmin = anyRoleGuard(UserRole.ChessSales, UserRole.SuperAdmin);

chessLeadRoute.get("/", jwt, anySalesOrAdmin, listChessLeads);
chessLeadRoute.get("/stats", jwt, anySalesOrAdmin, getChessLeadStats);
chessLeadRoute.get("/logs", jwt, anySalesOrAdmin, getChessLeadLog);
chessLeadRoute.post("/logs", jwt, anySalesOrAdmin, createChessLeadLog);
chessLeadRoute.get("/:id", jwt, anySalesOrAdmin, getChessLeadById);
chessLeadRoute.post("/", jwt, anySalesOrAdmin, createChessLead);
chessLeadRoute.patch("/:id", jwt, anySalesOrAdmin, updateChessLead);
// Delete restricted to SuperAdmin — sales team can update status to
// "Not converted" instead of nuking history.
chessLeadRoute.delete("/:id", jwt, roleGuard(UserRole.SuperAdmin), deleteChessLead);

export { chessLeadRoute };
