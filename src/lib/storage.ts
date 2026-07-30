import "server-only";

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const ENDPOINT = process.env.CLOUDFLARE_R2_ENDPOINT;
const BUCKET = process.env.CLOUDFLARE_R2_BUCKET;

export type StorageFile = {
  id: string;
  name: string;
  path: string;
  size: number;
  createdAt: string;
  updatedAt: string;
  contentType?: string;
  publicUrl: string;
};

export type StorageSnapshot = {
  files: StorageFile[];
  folders: string[];
  path: string;
};

let client: S3Client | null = null;

function getClient() {
  if (!client) {
    if (!ACCESS_KEY_ID || !SECRET_ACCESS_KEY || !ENDPOINT || !BUCKET) {
      throw new Error("Missing R2 credentials/env");
    }
    client = new S3Client({
      region: "auto",
      endpoint: ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: ACCESS_KEY_ID,
        secretAccessKey: SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

function normalizePath(path?: string) {
  if (!path) return "";
  return path.replace(/\\+/g, "/").replace(/^\/+|\/+$/g, "");
}

function encodePathForUrl(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodeSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Serializes concurrent operations that target the same path key so two
// requests can't both observe "not found" and pick the same candidate name.
const pathLocks = new Map<string, Promise<unknown>>();

function withPathLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prior = pathLocks.get(key) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  const tracked = run.catch(() => {});
  pathLocks.set(key, tracked);
  run.finally(() => {
    if (pathLocks.get(key) === tracked) {
      pathLocks.delete(key);
    }
  });
  return run;
}

// Tracks candidate paths that were just handed out as upload targets but may
// not exist in R2 yet (the client PUTs asynchronously after the signed URL
// is issued), so a second concurrent request for the same name doesn't also
// see a 404 and collide with it.
const reservedPaths = new Map<string, number>();
const DEFAULT_RESERVATION_TTL_MS = 5 * 60 * 1000;

function isReserved(path: string) {
  const expiresAt = reservedPaths.get(path);
  if (expiresAt === undefined) return false;
  if (expiresAt < Date.now()) {
    reservedPaths.delete(path);
    return false;
  }
  return true;
}

function reservePath(path: string, ttlMs: number = DEFAULT_RESERVATION_TTL_MS) {
  reservedPaths.set(path, Date.now() + ttlMs);
}

// Single-PUT limit for S3-compatible storage (R2 follows the same 5GiB cap as S3).
export const MAX_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024 * 1024;

const MIN_UPLOAD_EXPIRY_SECONDS = 60 * 5;
const MAX_UPLOAD_EXPIRY_SECONDS = 60 * 60;

// Scales the presigned URL's lifetime with file size so large uploads on slow
// connections don't have their signature expire mid-transfer.
function computeUploadExpirySeconds(fileSize?: number) {
  if (!fileSize || fileSize <= 0) return MIN_UPLOAD_EXPIRY_SECONDS;
  const estimatedSeconds = Math.ceil(fileSize / (1024 * 1024)) * 2; // ~2s per MB, generous for slow uplinks
  return Math.min(MAX_UPLOAD_EXPIRY_SECONDS, Math.max(MIN_UPLOAD_EXPIRY_SECONDS, estimatedSeconds));
}

export async function listEntries(path?: string): Promise<StorageSnapshot> {
  const prefix = normalizePath(path);
  const keyPrefix = prefix ? `${prefix}/` : undefined;
  const s3 = getClient();
  let ContinuationToken: string | undefined;
  const folders = new Set<string>();
  const files: StorageFile[] = [];

  do {
    const { Contents = [], CommonPrefixes = [], NextContinuationToken } = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: keyPrefix,
        Delimiter: "/",
        ContinuationToken,
      }),
    );

    for (const prefixObj of CommonPrefixes ?? []) {
      if (!prefixObj.Prefix) continue;
      const folderName = prefixObj.Prefix.replace(keyPrefix ?? "", "").replace(/\/$/, "");
      if (folderName) folders.add(decodeSegment(folderName));
    }

    for (const item of Contents) {
      if (!item.Key) continue;
      const decoded = item.Key;
      if (decoded.endsWith("/.keep")) {
        const folderName = decoded.replace(prefix ? `${prefix}/` : "", "").replace("/.keep", "");
        if (folderName) {
          folders.add(decodeSegment(folderName));
        }
        continue;
      }
      const relative = prefix ? decoded.replace(`${prefix}/`, "") : decoded;
      if (relative.includes("/")) {
        folders.add(decodeSegment(relative.split("/")[0]));
        continue;
      }
      files.push({
        id: item.Key,
        name: decodeSegment(relative),
        path: prefix ? `${prefix}/${relative}` : relative,
        size: Number(item.Size ?? 0),
        createdAt: item.LastModified?.toISOString() ?? new Date().toISOString(),
        updatedAt: item.LastModified?.toISOString() ?? new Date().toISOString(),
        publicUrl: `${(ENDPOINT ?? "").replace(/\/$/, "")}/${BUCKET ?? ""}/${encodePathForUrl(prefix ? `${prefix}/${relative}` : relative)}`,
      });
    }

    ContinuationToken = NextContinuationToken;
  } while (ContinuationToken);

  return { files, folders: Array.from(folders), path: prefix };
}

export async function deleteFile(path: string) {
  const s3 = getClient();
  await s3.send(
    new DeleteObjectCommand({
      Bucket: BUCKET,
      Key: path,
    }),
  );
}

const DELETE_BATCH_SIZE = 1000; // S3/R2 DeleteObjects limit per request

export async function deleteFiles(paths: string[]) {
  const keys = [...new Set(paths)].filter(Boolean);
  if (keys.length === 0) return;

  const s3 = getClient();
  for (let index = 0; index < keys.length; index += DELETE_BATCH_SIZE) {
    const chunk = keys.slice(index, index + DELETE_BATCH_SIZE);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: BUCKET,
        Delete: { Objects: chunk.map((Key) => ({ Key })) },
      }),
    );
  }
}

export async function deleteFolder(path: string) {
  const prefix = normalizePath(path);
  if (!prefix) throw new Error("루트는 삭제할 수 없습니다.");

  const s3 = getClient();
  const keyPrefix = prefix;
  let ContinuationToken: string | undefined;
  const keys: string[] = [];

  do {
    const { Contents = [], NextContinuationToken } = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: keyPrefix,
        ContinuationToken,
      }),
    );
    for (const item of Contents) {
      if (item.Key) keys.push(item.Key);
    }
    ContinuationToken = NextContinuationToken;
  } while (ContinuationToken);

  await deleteFiles(keys);
}

export async function createFolder(options: { name: string; parent?: string }) {
  const { name, parent } = options;
  const folderName = name.trim().replace(/[\\/]+/g, "-");
  if (!folderName) throw new Error("폴더 이름을 입력하세요.");

  const prefix = normalizePath(parent);
  const fullPath = prefix ? `${prefix}/${folderName}` : folderName;
  const s3 = getClient();

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: `${fullPath}/.keep`,
      Body: "",
      ContentType: "text/plain",
    }),
  );
}

export async function listAllFolders() {
  const s3 = getClient();
  let ContinuationToken: string | undefined;
  const folders = new Set<string>();

  do {
    const { Contents = [], NextContinuationToken } = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        ContinuationToken,
      }),
    );

    for (const item of Contents) {
      const key = item.Key;
      if (!key || !key.endsWith("/.keep")) continue;
      const normalized = key.replace(/\/+/, "/");
      const segments = normalized.split("/").filter(Boolean);
      if (segments.length <= 1) continue;
      const folderSegments = segments.slice(0, -1);
      for (let index = 1; index <= folderSegments.length; index += 1) {
        const slice = folderSegments.slice(0, index);
        const joined = slice.map((segment) => decodeSegment(segment)).join("/");
        if (joined) folders.add(joined);
      }
    }

    ContinuationToken = NextContinuationToken;
  } while (ContinuationToken);

  return Array.from(folders).sort((a, b) => a.localeCompare(b));
}

export type SearchResult = StorageFile & { folder: string };

const SEARCH_RESULT_LIMIT = 200;

export async function searchFiles(query: string): Promise<SearchResult[]> {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const s3 = getClient();
  let ContinuationToken: string | undefined;
  const results: SearchResult[] = [];

  do {
    const { Contents = [], NextContinuationToken } = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        ContinuationToken,
      }),
    );

    for (const item of Contents) {
      if (!item.Key || item.Key.endsWith("/.keep")) continue;
      const segments = item.Key.split("/").filter(Boolean);
      const name = decodeSegment(segments[segments.length - 1] ?? "");
      if (!name.toLowerCase().includes(normalizedQuery)) continue;

      const folder = segments
        .slice(0, -1)
        .map((segment) => decodeSegment(segment))
        .join("/");

      results.push({
        id: item.Key,
        name,
        path: item.Key,
        folder,
        size: Number(item.Size ?? 0),
        createdAt: item.LastModified?.toISOString() ?? new Date().toISOString(),
        updatedAt: item.LastModified?.toISOString() ?? new Date().toISOString(),
        publicUrl: `${(ENDPOINT ?? "").replace(/\/$/, "")}/${BUCKET ?? ""}/${encodePathForUrl(item.Key)}`,
      });

      if (results.length >= SEARCH_RESULT_LIMIT) return results;
    }

    ContinuationToken = NextContinuationToken;
  } while (ContinuationToken);

  return results;
}

export async function prepareUploadTarget(options: {
  fileName: string;
  folder?: string;
  contentType?: string;
  fileSize?: number;
  expiresIn?: number;
}) {
  const { fileName, folder, contentType, fileSize, expiresIn } = options;

  if (fileSize !== undefined && fileSize > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error("파일 크기가 5GB를 초과합니다.");
  }

  const resolvedExpiresIn = expiresIn ?? computeUploadExpirySeconds(fileSize);
  const folderPrefix = normalizePath(folder);
  const extensionMatch = fileName.match(/(.*)(\.[^.]*)$/);
  const nameWithoutExt = extensionMatch ? extensionMatch[1] : fileName;
  const ext = extensionMatch ? extensionMatch[2] : "";
  const lockKey = folderPrefix ? `${folderPrefix}/${fileName}` : fileName;

  const s3 = getClient();

  const candidatePath = await withPathLock(lockKey, async () => {
    let candidate = folderPrefix ? `${folderPrefix}/${fileName}` : fileName;
    let counter = 1;

    while (true) {
      if (!isReserved(candidate)) {
        try {
          await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: candidate }));
        } catch (error) {
          const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
          if (status === 404) {
            break;
          }
          throw error;
        }
      }
      const nextName = `${nameWithoutExt}(${counter})${ext}`;
      candidate = folderPrefix ? `${folderPrefix}/${nextName}` : nextName;
      counter += 1;
    }

    // Keep the reservation alive at least as long as the signed URL, plus
    // a buffer, so the name can't be re-claimed while the PUT is in flight.
    reservePath(candidate, (resolvedExpiresIn + 60) * 1000);
    return candidate;
  });

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: candidatePath,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: resolvedExpiresIn });
  const publicUrl = `${(ENDPOINT ?? "").replace(/\/$/, "")}/${BUCKET ?? ""}/${encodePathForUrl(candidatePath)}`;

  return {
    path: candidatePath,
    uploadUrl,
    publicUrl,
  };
}

export async function createSignedDownloadUrl(path: string, expiresInSeconds = 60 * 5) {
  const s3 = getClient();
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: path });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

export function getBucketLabel() {
  return BUCKET ?? "";
}

export async function renameObject(options: { path: string; newName: string }) {
  const { path, newName } = options;
  const cleanName = newName.trim().replace(/[\\/]+/g, "-");
  if (!cleanName) {
    throw new Error("새 이름을 입력하세요.");
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) {
    throw new Error("잘못된 경로입니다.");
  }
  parts.pop();
  const parent = parts.join("/");

  const match = cleanName.match(/(.*)(\.[^.]*)$/);
  const nameWithoutExt = match ? match[1] : cleanName;
  const ext = match ? match[2] : "";

  let candidate = parent ? `${parent}/${cleanName}` : cleanName;
  let counter = 1;
  const s3 = getClient();

  while (true) {
    if (candidate === path) break;
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: candidate }));
      const nextName = `${nameWithoutExt}(${counter})${ext}`;
      candidate = parent ? `${parent}/${nextName}` : nextName;
      counter += 1;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404) {
        break;
      }
      throw error;
    }
  }

  if (candidate !== path) {
    await s3.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: `${BUCKET}/${encodePathForUrl(path)}`,
        Key: candidate,
        MetadataDirective: "COPY",
      }),
    );
    await deleteFile(path);
  }

  return candidate;
}

export async function moveObject(options: { path: string; targetFolder?: string }) {
  const { path, targetFolder } = options;
  const normalizedTarget = normalizePath(targetFolder);
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) throw new Error("잘못된 경로입니다.");
  const fileName = segments.pop()!;
  const destinationFolder = normalizedTarget;

  const originalPath = path;
  const targetBase = destinationFolder ? `${destinationFolder}/${fileName}` : fileName;
  const match = fileName.match(/(.*)(\.[^.]*)$/);
  const nameWithoutExt = match ? match[1] : fileName;
  const ext = match ? match[2] : "";

  let candidate = targetBase;
  let counter = 1;
  const s3 = getClient();

  while (candidate !== originalPath) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: candidate }));
      const nextName = `${nameWithoutExt}(${counter})${ext}`;
      candidate = destinationFolder ? `${destinationFolder}/${nextName}` : nextName;
      counter += 1;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404) {
        break;
      }
      throw error;
    }
  }

  if (candidate === originalPath) {
    return candidate;
  }

  await s3.send(
    new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/${encodePathForUrl(originalPath)}`,
      Key: candidate,
      MetadataDirective: "COPY",
    }),
  );
  await deleteFile(originalPath);

  // remove empty source folder .keep? optional not necessary.

  return candidate;
}
