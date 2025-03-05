import { Router } from "express";
const passport = require("passport");
import multer from "multer";
import {
  uploadFile,
  uploadFileToGcpStorage,
} from "../controllers/storageController";
const storageRoute = Router();

const upload = multer({ storage: multer.memoryStorage() });
storageRoute.post(
  "/upload/docn",
  upload.single("file"),
  passport.authenticate("jwt", { session: false }),
  uploadFile
);
storageRoute.post(
  "/upload/gcp",
  upload.single("file"),
  passport.authenticate("jwt", { session: false }),
  uploadFileToGcpStorage
);

export { storageRoute };
