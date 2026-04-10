import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandInput,
  PutBucketCorsCommand,
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

