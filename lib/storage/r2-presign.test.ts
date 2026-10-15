import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const FIXTURE_SECRET = "fixture-secret-access-key-not-real";
const FIXTURE_ACCESS_KEY = "fixture-access-key";
const BUCKET = "fixture-files-bucket";
const KEY = "orders/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.jpeg";
const CONTENT_TYPE = "image/jpeg";

const clientBase = {
  region: "auto",
  endpoint: "https://fixture.example.invalid",
  forcePathStyle: true,
  credentials: {
    accessKeyId: FIXTURE_ACCESS_KEY,
    secretAccessKey: FIXTURE_SECRET,
  },
} as const;

type UrlSummary = {
  checksumQueryNames: string[];
  signedHeaders: string[];
  contentTypeSigned: boolean;
  expiresSeconds: string | null;
  bucketInPath: boolean;
  keyInPath: boolean;
  containsSecret: boolean;
  containsCrc32Token: boolean;
};

function summarize(url: string): UrlSummary {
  const parsed = new URL(url);
  const names = [...parsed.searchParams.keys()];
  const signedHeaders = (parsed.searchParams.get("X-Amz-SignedHeaders") ?? "")
    .split(";")
    .filter(Boolean);
  const pathName = decodeURIComponent(parsed.pathname);
  const values = [...parsed.searchParams.values()];
  return {
    checksumQueryNames: names.filter((name) => name.toLowerCase().includes("checksum")),
    signedHeaders,
    contentTypeSigned: signedHeaders.includes("content-type"),
    expiresSeconds: parsed.searchParams.get("X-Amz-Expires"),
    bucketInPath: pathName.includes(BUCKET),
    keyInPath: pathName.includes(KEY),
    containsSecret: url.includes(FIXTURE_SECRET),
    containsCrc32Token: values.some((value) => value.toUpperCase().includes("CRC32")),
  };
}

async function signPut(
  extra: Record<string, string> = {}
): Promise<UrlSummary> {
  const client = new S3Client({ ...clientBase, ...extra });
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: KEY,
      ContentType: CONTENT_TYPE,
    }),
    { expiresIn: 900 }
  );
  return summarize(url);
}

describe("R2 presigned PUT checksums", () => {
  it("SDK default adds optional CRC32 query params and does not sign content-type", async () => {
    const summary = await signPut();
    assert.deepEqual(summary.checksumQueryNames, [
      "x-amz-checksum-crc32",
      "x-amz-sdk-checksum-algorithm",
    ]);
    assert.equal(summary.containsCrc32Token, true);
    assert.deepEqual(summary.signedHeaders, ["host"]);
    assert.equal(summary.contentTypeSigned, false);
    assert.equal(summary.expiresSeconds, "900");
    assert.equal(summary.bucketInPath, true);
    assert.equal(summary.keyInPath, true);
    assert.equal(summary.containsSecret, false);
  });

  it("WHEN_REQUIRED removes optional checksum params and keeps the same signed headers", async () => {
    const current = await signPut();
    const required = await signPut({
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    assert.deepEqual(required.checksumQueryNames, []);
    assert.equal(required.containsCrc32Token, false);
    assert.deepEqual(required.signedHeaders, current.signedHeaders);
    assert.equal(required.contentTypeSigned, current.contentTypeSigned);
    assert.equal(required.expiresSeconds, "900");
    assert.equal(required.bucketInPath, true);
    assert.equal(required.keyInPath, true);
    assert.equal(required.containsSecret, false);

    const getClient = new S3Client({
      ...clientBase,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
    const getSummary = summarize(
      await getSignedUrl(
        getClient,
        new GetObjectCommand({ Bucket: BUCKET, Key: KEY }),
        { expiresIn: 300 }
      )
    );
    assert.deepEqual(getSummary.checksumQueryNames, []);
    assert.equal(getSummary.containsSecret, false);
  });

  it("createR2Client disables only optional checksums", () => {
    const source = readFileSync(path.join(import.meta.dirname, "r2.ts"), "utf8");
    const client = source.slice(
      source.indexOf("function createR2Client"),
      source.indexOf("function bucketName")
    );
    assert.match(client, /requestChecksumCalculation:\s*"WHEN_REQUIRED"/);
    assert.match(client, /responseChecksumValidation:\s*"WHEN_REQUIRED"/);
    assert.match(source, /ContentType:\s*input\.contentType/);
    assert.equal(source.includes(FIXTURE_SECRET), false);
  });

  it("presignPut and presignGet omit checksum query params", () => {
    const moduleUrl = pathToFileURL(path.join(import.meta.dirname, "r2.ts")).href;
    const probe = `
      const { presignPut, presignGet } = await import(process.env.R2_MODULE_URL);
      const putUrl = await presignPut({
        key: process.env.R2_FIXTURE_KEY,
        contentType: "image/jpeg",
        expiresIn: 900,
      });
      const getUrl = await presignGet({
        key: process.env.R2_FIXTURE_KEY,
        expiresIn: 300,
      });
      const summarize = (url) => {
        const parsed = new URL(url);
        const names = [...parsed.searchParams.keys()];
        const signedHeaders = (parsed.searchParams.get("X-Amz-SignedHeaders") ?? "")
          .split(";").filter(Boolean);
        const pathName = decodeURIComponent(parsed.pathname);
        const values = [...parsed.searchParams.values()];
        return {
          checksumQueryNames: names.filter((name) => name.toLowerCase().includes("checksum")),
          signedHeaders,
          contentTypeSigned: signedHeaders.includes("content-type"),
          expiresSeconds: parsed.searchParams.get("X-Amz-Expires"),
          bucketInPath: pathName.includes(process.env.R2_BUCKET_NAME),
          keyInPath: pathName.includes(process.env.R2_FIXTURE_KEY),
          containsSecret: url.includes(process.env.R2_SECRET_ACCESS_KEY),
          containsCrc32Token: values.some((value) => value.toUpperCase().includes("CRC32")),
        };
      };
      process.stdout.write(JSON.stringify({ put: summarize(putUrl), get: summarize(getUrl) }));
    `;
    const env = { ...process.env };
    delete env.AWS_REQUEST_CHECKSUM_CALCULATION;
    delete env.AWS_RESPONSE_CHECKSUM_VALIDATION;
    delete env.AWS_ACCESS_KEY_ID;
    delete env.AWS_SECRET_ACCESS_KEY;
    delete env.AWS_SESSION_TOKEN;
    delete env.AWS_PROFILE;
    env.R2_ACCOUNT_ID = "fixtureaccount";
    env.R2_ACCESS_KEY_ID = FIXTURE_ACCESS_KEY;
    env.R2_SECRET_ACCESS_KEY = FIXTURE_SECRET;
    env.R2_BUCKET_NAME = BUCKET;
    env.R2_ENDPOINT = "https://fixture.example.invalid";
    env.R2_FIXTURE_KEY = KEY;
    env.R2_MODULE_URL = moduleUrl;

    const result = spawnSync(
      process.execPath,
      ["--conditions=react-server", "--input-type=module", "--eval", probe],
      { env, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr || "presign probe failed");
    assert.equal(result.stdout.includes("X-Amz-Signature"), false);
    assert.equal(result.stdout.includes(FIXTURE_SECRET), false);
    const body = JSON.parse(result.stdout) as { put: UrlSummary; get: UrlSummary };
    assert.deepEqual(body.put.checksumQueryNames, []);
    assert.equal(body.put.containsCrc32Token, false);
    assert.deepEqual(body.put.signedHeaders, ["host"]);
    assert.equal(body.put.contentTypeSigned, false);
    assert.equal(body.put.expiresSeconds, "900");
    assert.equal(body.put.bucketInPath, true);
    assert.equal(body.put.keyInPath, true);
    assert.equal(body.put.containsSecret, false);
    assert.deepEqual(body.get.checksumQueryNames, []);
    assert.equal(body.get.expiresSeconds, "300");
    assert.equal(body.get.bucketInPath, true);
    assert.equal(body.get.keyInPath, true);
    assert.equal(body.get.containsSecret, false);
  });
});
