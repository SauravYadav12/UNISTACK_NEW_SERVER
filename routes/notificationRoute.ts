import { Router } from "express";
import passport from "passport";
import {
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from "../controllers/notificationController";

const notificationRoute = Router();

const jwt = passport.authenticate("jwt", { session: false });

notificationRoute.get("/", jwt, listNotifications);
notificationRoute.get("/unread-count", jwt, unreadCount);
notificationRoute.patch("/read-all", jwt, markAllRead);
notificationRoute.patch("/:id/read", jwt, markRead);

export { notificationRoute };
