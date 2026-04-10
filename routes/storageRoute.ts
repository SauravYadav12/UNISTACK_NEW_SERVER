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


export { storageRoute };
