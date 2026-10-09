import { Router } from "express";
import passport from "passport";
import {
  listSourcedJobs,
  getSourcedJob,
  updateSourcedJob,
  approveSourcedJob,
  rejectSourcedJob,
  runEmailIngest,
  runJsearchIngest,
  runFeedIngest,
} from "../controllers/itJobSearchController";

const itJobSearchRoute = Router();
const jwt = passport.authenticate("jwt", { session: false });

itJobSearchRoute.get("/", jwt, listSourcedJobs);
itJobSearchRoute.post("/ingest/run", jwt, runEmailIngest);
itJobSearchRoute.post("/ingest/jsearch", jwt, runJsearchIngest);
itJobSearchRoute.post("/ingest/feeds", jwt, runFeedIngest);
itJobSearchRoute.get("/:id", jwt, getSourcedJob);
itJobSearchRoute.patch("/:id", jwt, updateSourcedJob);
itJobSearchRoute.post("/:id/approve", jwt, approveSourcedJob);
itJobSearchRoute.post("/:id/reject", jwt, rejectSourcedJob);

export { itJobSearchRoute };
