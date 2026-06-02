import { Router } from "express";
import passport from "passport";
import {
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
  deleteOne,
  deleteAll,
} from "../controllers/notificationController";

const notificationRoute = Router();

const jwt = passport.authenticate("jwt", { session: false });

notificationRoute.get("/", jwt, listNotifications);
notificationRoute.get("/unread-count", jwt, unreadCount);
notificationRoute.patch("/read-all", jwt, markAllRead);
notificationRoute.patch("/:id/read", jwt, markRead);
// Hard-delete endpoints — back the "X on each row" + "Clear all"
// affordances in the drawer. UI updates are optimistic; these calls
// are fire-and-forget from the client.
notificationRoute.delete("/", jwt, deleteAll);
notificationRoute.delete("/:id", jwt, deleteOne);

export { notificationRoute };
