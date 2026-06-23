import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandInput,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Request, Response } from "express";
import ENV_VARS from "../config/env.config";

const endpoint = ENV_VARS.S3CLIENT_END_POINT;
const accessKeyId = ENV_VARS.STORAGE_ACCESS_KEY_ID as string;
const secretAccessKey = ENV_VARS.STORAGE_SECRET_ACCESS_KEY as string;
const bucket = ENV_VARS.STORAGE_BUCKET as string;
const bucket2 = ENV_VARS.STORAGE_BUCKET_2 as string;
if (!accessKeyId || !secretAccessKey || !bucket || !endpoint || !bucket2) {
  console.log("invalid storage configuration : ", "Invalid Keys");
  console.log({ accessKeyId, secretAccessKey, bucket, endpoint, bucket2 });
}

const s3Client = new S3Client({
  endpoint,
  forcePathStyle: true,
  region: "blr1",
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

function trimTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * Build the public object URL for a given bucket + key. Two endpoint
 * shapes are supported, since DO Spaces accepts either:
 *
 *   1. Region-only host (recommended with `forcePathStyle: true`):
 *      `https://blr1.digitaloceanspaces.com`
 *      → URL = `https://<bucket>.blr1.digitaloceanspaces.com/<key>`
 *
 *   2. Virtual-host shaped endpoint left over from before the
 *      multi-bucket setup, e.g. `https://<oldBucket>.<region>.…/`.
 *      → We strip the leading subdomain and rebuild against the
 *        actual target bucket so the URL points at the right place
 *        regardless of how the endpoint was originally configured.
 *
 * Without this, returned URLs always said `unistack-storage` even
 * after the real bucket was renamed — broke every uploaded file's
 * preview link app-wide.
 */
function buildObjectUrl(bucketName: string, key: string): string {
  const ep = trimTrailingSlash(endpoint || "");
  // Split protocol + host so we can analyse the host portion.
  const protoMatch = ep.match(/^https?:\/\//);
  const protocol = protoMatch ? protoMatch[0] : "https://";
  const host = ep.slice(protocol.length).split("/")[0];

  // Region-only host (preferred): "<region>.digitaloceanspaces.com".
  if (/^[a-z0-9]+\.digitaloceanspaces\.com$/.test(host)) {
    return `${protocol}${bucketName}.${host}/${key}`;
  }

  // Bucket-in-subdomain host: "<oldBucket>.<region>.digitaloceanspaces.com".
  // Replace the first segment with the actual bucket name so legacy
  // endpoint configs still produce a working URL.
  if (/\.digitaloceanspaces\.com$/.test(host)) {
    const tail = host.split(".").slice(1).join(".");
    return `${protocol}${bucketName}.${tail}/${key}`;
  }

  // Fallback: path-style URL against whatever was configured.
  return `${ep}/${bucketName}/${key}`;
}

export const uploadFile = async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No file to upload" });
    return;
  }

  // Pick the right bucket based on the `?bucket=` query. The primary
  // bucket handles general document uploads; the secondary holds
  // interview-script PDFs so they don't share a namespace with
  // candidate resumes etc.
  const bucketToUse = req.query.bucket === "script" ? bucket2 : bucket;
  if (!bucketToUse) {
    res.status(500).json({ error: "Storage bucket not configured" });
    return;
  }

  try {
    const key = `uploads/${Date.now()}-${req.file.originalname}`;
    const params: PutObjectCommandInput = {
      // Use bucketToUse here — previously hardcoded `bucket` which
      // meant `?bucket=script` was silently ignored at PutObject
      // time, and every upload went to whatever the primary bucket
      // was even if the caller asked for the secondary.
      Bucket: bucketToUse,
      Key: key,
      Body: req.file.buffer,
      ACL: "public-read",
      ContentType: req.file.mimetype,
    };

    await s3Client.send(new PutObjectCommand(params));
    // Build the public URL from the actual bucket we wrote to, not a
    // hardcoded name. Earlier code returned `${endpoint}/unistack-storage/<key>`
    // regardless of the real bucket, so file links 404'd after the
    // bucket was renamed.
    const url = buildObjectUrl(bucketToUse, key);
    res.json({
      data: {
        url,
      },
    });
  } catch (err) {
    // Surface the error message back to the client (the React side
    // shows `error?.response?.data?.error || 'Failed to upload'`).
    // Otherwise every failure looked identical and we lost the AWS
    // error name (NoSuchBucket, AccessDenied, etc) in the network tab.
    console.error("Upload error:", err);
    const message =
      err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message || "Upload failed" });
  }
};

// NOTE on CORS: the previous implementation ran `PutBucketCorsCommand`
// on every single upload. That had two problems:
//   1. It required the access key to hold `s3:PutBucketCors` for the
//      bucket. When that perm wasn't granted, EVERY upload 500'd.
//   2. The pushed CORS only allowed `GET`/`HEAD`, so it overwrote
//      whatever wildcard `POST/PUT` rules were set manually (which we
//      need for direct-from-browser uploads).
// CORS is now a one-time setup operation. To configure it, run from
// any machine with the access key:
//
//   aws s3api put-bucket-cors \
//     --endpoint=https://blr1.digitaloceanspaces.com \
//     --bucket <bucket> \
//     --cors-configuration file://cors.json
//
// with cors.json allowing the methods + origins we actually need.

/**
 * Programmatic delete helper for the S3 bucket — used by onboarding's
 * candidate-delete flow to clean up uploaded documents alongside the
 * candidate record. Returns true if the object was removed (or didn't
 * exist), false on a network/credential error.
 *
 * Accepts a full URL produced by `buildObjectUrl`. The URL can name
 * EITHER configured bucket (the primary general-docs bucket, or the
 * secondary script bucket); we resolve which one based on whichever
 * name appears in the URL. Legacy URLs that contain `unistack-storage`
 * are still resolvable because the bucket env may still hold that
 * name for old environments.
 */
export async function deleteS3ObjectByUrl(url: string): Promise<boolean> {
  if (!url) return false;

  // Try every configured bucket name + a known legacy alias against
  // both URL styles (virtual-host: ".<bucket>." in the host, and
  // path-style: "/<bucket>/" in the path). Whichever matches wins.
  const candidates = Array.from(
    new Set(
      [bucket, bucket2, "unistack-storage"].filter(
        (b): b is string => !!b,
      ),
    ),
  );

  let resolvedBucket: string | undefined;
  let key: string | undefined;

  for (const b of candidates) {
    // Path-style: "<host>/<bucket>/<key>"
    const pathMarker = `/${b}/`;
    const pIdx = url.indexOf(pathMarker);
    if (pIdx >= 0) {
      resolvedBucket = b;
      key = url.slice(pIdx + pathMarker.length);
      break;
    }
    // Virtual-host: "<bucket>.<rest>/<key>"
    const vMarker = `://${b}.`;
    const vIdx = url.indexOf(vMarker);
    if (vIdx >= 0) {
      const slashIdx = url.indexOf("/", vIdx + vMarker.length);
      if (slashIdx >= 0) {
        resolvedBucket = b;
        key = url.slice(slashIdx + 1);
        break;
      }
    }
  }

  if (!resolvedBucket || !key) return false;
  // Always delete from a bucket we still have credentials for. If the
  // URL pointed at the legacy alias but our env names different live
  // buckets, fall back to the primary bucket — the object may have
  // been moved during a rename.
  const targetBucket =
    resolvedBucket === bucket || resolvedBucket === bucket2
      ? resolvedBucket
      : bucket;

  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: targetBucket,
        Key: key,
      }),
    );
    return true;
  } catch (err) {
    console.error("[storage] S3 delete failed for", key, err);
    return false;
  }
}
