import express from "express";
import passport from "passport";
import { roleGuard } from "../middleware/adminGuard";
import { UserRole } from "../enums/UserEnum";
import {
  getQuoCallSummary,
  getQuoCallTranscript,
  listQuoActivity,
  listQuoCalls,
  listQuoMessages,
  listQuoPhoneNumbers,
  listQuoVoicemails,
  patchQuoPhoneNumberLabel,
  proxyQuoRecording,
  proxyQuoVoicemail,
  reconcileQuoPhoneNumber,
  syncQuoPhoneNumbers,
} from "../controllers/quoAdminController";

const quoRoute = express.Router();
const jwt = passport.authenticate("jwt", { session: false });
const superOnly = roleGuard(UserRole.SuperAdmin);

// Specific routes before parametric — /phone-numbers/sync must come
// before /:id or the :id would swallow "sync".
quoRoute.get("/phone-numbers", jwt, superOnly, listQuoPhoneNumbers);
quoRoute.post("/phone-numbers/sync", jwt, superOnly, syncQuoPhoneNumbers);
quoRoute.patch("/phone-numbers/:id/label", jwt, superOnly, patchQuoPhoneNumberLabel);
quoRoute.post(
  "/phone-numbers/:id/reconcile",
  jwt,
  superOnly,
  reconcileQuoPhoneNumber,
);

// Timeline reads (from local mirror — cheap, filterable).
quoRoute.get("/activity", jwt, superOnly, listQuoActivity);
quoRoute.get("/calls", jwt, superOnly, listQuoCalls);
quoRoute.get("/messages", jwt, superOnly, listQuoMessages);
quoRoute.get("/voicemails", jwt, superOnly, listQuoVoicemails);

// Audio proxies + AI pull-through.
quoRoute.get("/calls/:callId/recording", jwt, superOnly, proxyQuoRecording);
quoRoute.get("/calls/:callId/voicemail", jwt, superOnly, proxyQuoVoicemail);
quoRoute.get("/calls/:callId/summary", jwt, superOnly, getQuoCallSummary);
quoRoute.get("/calls/:callId/transcript", jwt, superOnly, getQuoCallTranscript);

export { quoRoute };
