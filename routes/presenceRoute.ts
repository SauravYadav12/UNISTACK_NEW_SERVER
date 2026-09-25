import { Router } from "express";
import passport from "passport";
import multer from "multer";
import {
  board,
  ingestEvent,
  ingestUnidentified,
  listUnidentified,
  resolveUnidentified,
} from "../controllers/presenceController";
import { presenceApiKey } from "../middleware/presenceApiKey";
import { anyRoleGuard } from "../middleware/adminGuard";
import { BREAK_ADMIN_ROLES } from "../services/breakService";

/**
 * Mounted at /presence. The two ingest endpoints are called by the local
 * vision service (Mark1) with `x-api-key`; everything else is JWT.
 */
const presenceRoute = Router();
const jwt = passport.authenticate("jwt", { session: false });
const adminOnly = anyRoleGuard(...BREAK_ADMIN_ROLES);

const snapshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/jpg", "image/png"].includes(file.mimetype)) cb(null, true);
    else cb(new Error("Only JPG / PNG snapshots are allowed"));
  },
});

// Vision service → server.
presenceRoute.post("/events", presenceApiKey, ingestEvent);
presenceRoute.post(
  "/unidentified",
  presenceApiKey,
  (req, res, next) => {
    snapshotUpload.single("image")(req, res, (err) => {
      if (err) {
        res.status(400).json({ status: "failed", error: err.message || String(err) });
        return;
      }
      next();
    });
  },
  ingestUnidentified,
);

// Team board — every employee can see who is working / on break.
presenceRoute.get("/board", jwt, board);

// Admin review of unidentified crossings.
presenceRoute.get("/unidentified", jwt, adminOnly, listUnidentified);
presenceRoute.post("/unidentified/:id/resolve", jwt, adminOnly, resolveUnidentified);

export { presenceRoute };
