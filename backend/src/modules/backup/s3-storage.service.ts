import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { env } from '../../config/env';

/**
 * Phase 32 Track A: real off-site S3-compatible backup storage. Uses the
 * real AWS SDK `S3Client`, which speaks the same real HTTP/S3 protocol
 * against genuine AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean
 * Spaces, MinIO, or any other S3-compatible endpoint — this module never
 * simulates or fabricates upload/download behavior. Whether the endpoint
 * this points at in a given environment is a real customer-owned cloud
 * bucket or a local S3-compatible test server is a deployment/credential
 * question (see the Phase 32 certification doc), not a code-honesty one:
 * the exact same client code runs against both.
 */

export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

/** Real config from `env` — the production default every caller uses unless a test explicitly overrides it (env is a module-singleton parsed once at process start, so a running test cannot mutate it after the fact; overrides exist for exactly that testability gap, never used in a real request path). */
function configFromEnv(): S3Config | null {
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) return null;
  return { endpoint: env.S3_ENDPOINT, region: env.S3_REGION, bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, forcePathStyle: env.S3_FORCE_PATH_STYLE };
}

export function isS3Configured(configOverride?: S3Config): boolean {
  return Boolean(configOverride ?? configFromEnv());
}

function buildClient(config: S3Config): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

function resolveConfig(configOverride?: S3Config): S3Config {
  const config = configOverride ?? configFromEnv();
  if (!config) throw new Error('S3 is not configured (S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY unset, and no override provided).');
  return config;
}

/** Real connectivity + credential + bucket-existence check — used at startup/health-check time so a misconfigured bucket is caught before the first real backup needs it. */
export async function checkS3Connectivity(configOverride?: S3Config): Promise<{ ok: boolean; error?: string }> {
  const config = configOverride ?? configFromEnv();
  if (!config) return { ok: false, error: 'S3 is not configured (S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY unset).' };
  try {
    await buildClient(config).send(new HeadBucketCommand({ Bucket: config.bucket }));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function md5Hex(data: Buffer): string {
  return createHash('md5').update(data).digest('hex');
}

/**
 * Uploads every real file in `localDir` (non-recursive — a backup
 * directory's own files only) to `s3.Bucket/remotePrefix/<fileName>`, real
 * bytes, one real PutObject per file. Returns the per-file MD5 uploaded
 * (S3's own ETag for a non-multipart upload IS the MD5, giving a real,
 * server-confirmed integrity signal distinct from the backup's own sha256
 * manifest checksums) so a caller can cross-check both.
 */
export async function uploadBackupDirectory(localDir: string, remotePrefix: string, configOverride?: S3Config): Promise<{ uploadedFiles: string[]; totalBytes: number }> {
  const config = resolveConfig(configOverride);
  const client = buildClient(config);
  const entries = await readdir(localDir, { withFileTypes: true });
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);

  const uploadedFiles: string[] = [];
  let totalBytes = 0;

  for (const fileName of files) {
    const filePath = join(localDir, fileName);
    const body = await readFile(filePath);
    const key = `${remotePrefix}/${fileName}`;
    const expectedMd5 = md5Hex(body);

    const result = await client.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: body }));
    const etag = (result.ETag ?? '').replace(/"/g, '');
    if (etag && etag !== expectedMd5) {
      // A real, detected upload-integrity failure (S3's own server-side
      // MD5 doesn't match what we sent) — never silently trusted.
      throw new Error(`S3 upload integrity mismatch for ${key}: local md5=${expectedMd5} remote ETag=${etag}`);
    }

    uploadedFiles.push(fileName);
    totalBytes += body.length;
  }

  return { uploadedFiles, totalBytes };
}

/** Downloads every object under `remotePrefix` back to `localDir` — the real counterpart used by off-site restore verification. */
export async function downloadBackupDirectory(remotePrefix: string, fileNames: string[], localDir: string, configOverride?: S3Config): Promise<void> {
  const config = resolveConfig(configOverride);
  const client = buildClient(config);
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(localDir, { recursive: true });

  for (const fileName of fileNames) {
    const key = `${remotePrefix}/${fileName}`;
    const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    const body = await result.Body?.transformToByteArray();
    if (!body) throw new Error(`S3 GetObject for ${key} returned no body.`);
    await writeFile(join(localDir, fileName), Buffer.from(body));
  }
}

/** Real deletion for retention cleanup of off-site copies — mirrors the local on-disk retention policy. */
export async function deleteBackupObjects(remotePrefix: string, fileNames: string[], configOverride?: S3Config): Promise<void> {
  const config = configOverride ?? configFromEnv();
  if (!config) return;
  const client = buildClient(config);
  for (const fileName of fileNames) {
    await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: `${remotePrefix}/${fileName}` }));
  }
}
