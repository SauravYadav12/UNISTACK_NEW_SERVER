import express from "express";
import passport from "passport";
import { roleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  getAllWeights,
  getMarketingLeaderboard,
  getSupportLeaderboard,
  resetWeights,
  updateWeights,
} from "../controllers/performanceController";

const performanceRoute = express.Router();
const jwt = passport.authenticate("jwt", { session: false });
const superOnly = roleGuard(UserRole.SuperAdmin);

performanceRoute.get("/marketing", jwt, getMarketingLeaderboard);
performanceRoute.get("/support", jwt, getSupportLeaderboard);
performanceRoute.get("/weights", jwt, getAllWeights);
performanceRoute.patch("/weights", jwt, superOnly, updateWeights);
performanceRoute.post("/weights/reset", jwt, superOnly, resetWeights);

export { performanceRoute };
