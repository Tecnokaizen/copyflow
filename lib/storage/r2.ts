import "server-only";

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export type R2HeadResult = {
  exists: boolean;
  contentLength: number | null;
  contentType: string | null;
  etag: string | null;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

function createR2Client() {
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
  const endpoint =
    process.env.R2_ENDPOINT?.trim() ||
    `https://${accountId}.r2.cloudflarestorage.com`;

  return new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
}

function bucketName() {
  return requireEnv("R2_BUCKET_NAME");
}

export async function presignPut(input: {
  key: string;
  contentType: string | null;
  expiresIn: number;
}): Promise<string> {
  const client = createR2Client();
  const command = new PutObjectCommand({
    Bucket: bucketName(),
    Key: input.key,
    ...(input.contentType ? { ContentType: input.contentType } : {}),
  });
  return getSignedUrl(client, command, { expiresIn: input.expiresIn });
}

export async function presignGet(input: {
  key: string;
  expiresIn: number;
  responseContentDisposition?: string;
  responseContentType?: string | null;
}): Promise<string> {
  const client = createR2Client();
  const command = new GetObjectCommand({
    Bucket: bucketName(),
    Key: input.key,
    ...(input.responseContentDisposition
      ? { ResponseContentDisposition: input.responseContentDisposition }
      : {}),
    ...(input.responseContentType
      ? { ResponseContentType: input.responseContentType }
      : {}),
  });
  return getSignedUrl(client, command, { expiresIn: input.expiresIn });
}

export async function headObject(input: { key: string }): Promise<R2HeadResult> {
  const client = createR2Client();
  try {
    const result = await client.send(
      new HeadObjectCommand({
        Bucket: bucketName(),
        Key: input.key,
      })
    );
    return {
      exists: true,
      contentLength:
        typeof result.ContentLength === "number" ? result.ContentLength : null,
      contentType: result.ContentType ?? null,
      etag: result.ETag ?? null,
    };
  } catch (error) {
    const status =
      typeof error === "object" &&
      error &&
      "$metadata" in error &&
      typeof (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === "number"
        ? (error as { $metadata: { httpStatusCode: number } }).$metadata
            .httpStatusCode
        : null;
    if (status === 404) {
      return {
        exists: false,
        contentLength: null,
        contentType: null,
        etag: null,
      };
    }
    throw error;
  }
}

export async function deleteObject(input: { key: string }): Promise<void> {
  const client = createR2Client();
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucketName(),
        Key: input.key,
      })
    );
  } catch (error) {
    const status =
      typeof error === "object" &&
      error &&
      "$metadata" in error &&
      typeof (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === "number"
        ? (error as { $metadata: { httpStatusCode: number } }).$metadata
            .httpStatusCode
        : null;
    if (status === 404) {
      return;
    }
    throw error;
  }
}
