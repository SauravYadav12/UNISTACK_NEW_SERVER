import { Router } from "express";
import passport from "passport";
import multer from "multer";
import {
  uploadFile,
} from "../controllers/storageController";
const storageRoute = Router();

const upload = multer({ storage: multer.memoryStorage() });
storageRoute.post(
  "/upload/docn",
  upload.single("file"),
  passport.authenticate("jwt", { session: false }),
  uploadFile
);

// Timesheet approval screenshots: image-only, 5 MB cap. Vendors often send
// screenshots of their approval system alongside each invoice — admins
// attach them per-week to the monthly timesheet.
const timesheetScreenshotUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(
        file.mimetype
      )
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only PNG / JPG / WEBP images are allowed"));
    }
  },
});
storageRoute.post(
  "/upload/timesheet-screenshot",
  passport.authenticate("jwt", { session: false }),
  (req, res, next) => {
    timesheetScreenshotUpload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || String(err) });
      }
      next();
    });
  },
  uploadFile
);

// Org logos: image-only, 2 MB cap. Kept isolated so the contract/invoice
// filters don't leak onto it (and vice versa).
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/svg+xml"].includes(
        file.mimetype
      )
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only PNG / JPG / WEBP / SVG images are allowed"));
    }
  },
});
storageRoute.post(
  "/upload/logo",
  passport.authenticate("jwt", { session: false }),
  (req, res, next) => {
    logoUpload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || String(err) });
      }
      next();
    });
  },
  uploadFile
);

// Invoice PDFs: same pattern as contracts, tighter 10 MB cap.
const invoiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed for invoices"));
  },
});
storageRoute.post(
  "/upload/invoice",
  passport.authenticate("jwt", { session: false }),
  (req, res, next) => {
    invoiceUpload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || String(err) });
      }
      next();
    });
  },
  uploadFile
);

// Form-16 PDFs: PDF only, 10 MB cap. Separate multer instance keeps
// the Form-16 upload path isolated from the invoice/contract surface.
const form16Upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed for Form-16"));
  },
});
storageRoute.post(
  "/upload/form16",
  passport.authenticate("jwt", { session: false }),
  (req, res, next) => {
    form16Upload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || String(err) });
      }
      next();
    });
  },
  uploadFile
);

// Contract uploads: PDF only, hard-capped at 20 MB. Separate multer
// instance so the filter doesn't leak onto /upload/docn.
const contractUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed for contracts"));
  },
});
storageRoute.post(
  "/upload/contract",
  passport.authenticate("jwt", { session: false }),
  (req, res, next) => {
    contractUpload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message || String(err) });
      }
      next();
    });
  },
  uploadFile
);


export { storageRoute };
