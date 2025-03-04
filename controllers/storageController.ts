import {
  S3Client,
  PutObjectCommand,
  PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { Request, Response } from "express";
import dotenv from "dotenv";
import { Storage } from "@google-cloud/storage";

dotenv.config({ path: "./config.env" });
const endpoint = process.env.S3CLIENT_END_POINT;
const accessKeyId = process.env.STORAGE_ACCESS_KEY_ID as string;
const secretAccessKey = process.env.STORAGE_SECRET_ACCESS_KEY as string;
const bucket = process.env.STORAGE_BUCKET;
const gcpBucket = process.env.GCP_STORAGE_BUCKET;

if (!accessKeyId || !secretAccessKey || !bucket || !endpoint || !gcpBucket) {
  console.log("invalid storage configuration : ", "Invalid Keys");
  console.log({ accessKeyId, secretAccessKey, bucket, endpoint, gcpBucket });
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

const gcpStorage = new Storage();

export const uploadFile = async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No file to uploaded" });
    return;
  }

  try {
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

export const uploadFileToGcpStorage = async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No file to uploaded" });
    return;
  }

  try {
    const key = `uploads/${Date.now()}-${req.file.originalname}`;
    await gcpStorage
      .bucket(gcpBucket || "")
      .file(key)
      .save(req.file.buffer);
    const url = `https://storage.googleapis.com/${gcpBucket}/${key}`;
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
