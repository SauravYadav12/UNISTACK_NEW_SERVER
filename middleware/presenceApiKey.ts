import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import ENV_VARS from "../config/env.config";

/**
 * Service-to-service gate for the local vision service (Mark1). The Mac
 * mini sends `x-api-key: <PRESENCE_API_KEY>`. Header rather than URL secret
 * so the key never lands in access logs; constant-time compare so timing
 * doesn't leak it.
 */
export function presenceApiKey(req: Request, res: Response, next: NextFunction): void {
  const expected = ENV_VARS.PRESENCE_API_KEY;
  if (!expected) {
    res.status(503).json({ status: "failed", error: "Presence ingest not configured" });
    return;
  }
  const provided = req.header("x-api-key") || "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ status: "failed", error: "Invalid API key" });
    return;
  }
  next();
}
