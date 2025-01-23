import { Router } from "express";

import passport from "passport";
import {
  createContactMessage,
  deleteContactMessage,
  getContactMessageById,
  getContactMessages,
  updateContactMessage,
} from "../controllers/contactMessageController";
const contactMessageRoutes = Router();

contactMessageRoutes.post("/", createContactMessage);
contactMessageRoutes.patch("/:id", updateContactMessage);
contactMessageRoutes.get(
  "/",
  passport.authenticate("jwt", { session: false }),
  getContactMessages
);
contactMessageRoutes.get(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  getContactMessageById
);
contactMessageRoutes.delete(
  "/:id",
  passport.authenticate("jwt", { session: false }),
  deleteContactMessage
);

export { contactMessageRoutes };
