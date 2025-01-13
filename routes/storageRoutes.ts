import { Router } from "express";
const passport = require("passport");
import multer from "multer";
import { uploadFile } from "../controllers/storageController";
const storageRoutes = Router();

const upload = multer({ storage: multer.memoryStorage() });
storageRoutes.post(
  "/upload",
  upload.single("file"),
  passport.authenticate("jwt", { session: false }),
  uploadFile
);

export { storageRoutes };
