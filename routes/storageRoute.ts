import { Router } from "express";
const passport = require("passport");
import multer from "multer";
import { uploadFile } from "../controllers/storageController";
const storageRoute = Router();

const upload = multer({ storage: multer.memoryStorage() });
storageRoute.post(
  "/upload",
  upload.single("file"),
  passport.authenticate("jwt", { session: false }),
  uploadFile
);

export { storageRoute };
