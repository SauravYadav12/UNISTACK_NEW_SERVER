import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandInput,
  PutBucketCorsCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { Request, Response } from "express";
import ENV_VARS from "../config/env.config";

const endpoint = ENV_VARS.S3CLIENT_END_POINT;
const accessKeyId = ENV_VARS.STORAGE_ACCESS_KEY_ID as string;
const secretAccessKey = ENV_VARS.STORAGE_SECRET_ACCESS_KEY as string;
const bucket = ENV_VARS.STORAGE_BUCKET;
const bucket2 = ENV_VARS.STORAGE_BUCKET_2;
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

export const uploadFile = async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No file to uploaded" });
    return;
  }

  const bucketToUse = req.query.bucket==="script" ? bucket2 : bucket;

  try {
    const corsParams = {
      Bucket: bucketToUse,
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: ENV_VARS.ALLOWED_ORIGINS || [],
            AllowedMethods: ["GET", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["Content-Type", "Content-Length"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    };

    await s3Client.send(new PutBucketCorsCommand(corsParams));

    const key = `uploads/${Date.now()}-${req.file.originalname}`;
    const params: PutObjectCommandInput = {
      Bucket: bucket,
      Key: key,
      Body: req.file.buffer,
      ACL: "public-read",
      ContentType: req.file.mimetype,
    };

    await s3Client.send(new PutObjectCommand(params));
    const mainEndPoint = endpoint?.endsWith("/")
      ? endpoint.slice(0, -1)
      : endpoint;
    const url = `${mainEndPoint}/unistack-storage/${key}`;
    res.json({
      data: {
        url,
      },
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err });
  }
};

/**
 * Programmatic delete helper for the S3 bucket — used by onboarding's
 * candidate-delete flow to clean up uploaded documents alongside the
 * candidate record. Returns true if the object was removed (or didn't
 * exist), false on a network/credential error.
 *
 * Accepts either a full URL (the same URL stored on the candidate's
 * formData.documents.* fields) or a raw S3 key.
 */
export async function deleteS3ObjectByUrl(url: string): Promise<boolean> {
  if (!url) return false;
  // URL pattern produced on upload:
  //   `${endpoint}/unistack-storage/${key}`
  // Find the bucket-path marker and take everything after it as the
  // S3 key. Falls back to the raw input if the marker isn't present.
  const marker = "/unistack-storage/";
  const idx = url.indexOf(marker);
  const key = idx >= 0 ? url.slice(idx + marker.length) : url;
  if (!key) return false;
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
    return true;
  } catch (err) {
    console.error("[storage] S3 delete failed for", key, err);
    return false;
  }
}
