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

  if (keys.length === 0) return;

  await s3.send(
    new DeleteObjectsCommand({
      Bucket: BUCKET,
      Delete: { Objects: keys.map((Key) => ({ Key })) },
    }),
  );
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

export async function prepareUploadTarget(options: {
  fileName: string;
  folder?: string;
  contentType?: string;
  expiresIn?: number;
}) {
  const { fileName, folder, contentType, expiresIn = 60 * 5 } = options;
  const folderPrefix = normalizePath(folder);
  const extensionMatch = fileName.match(/(.*)(\.[^.]*)$/);
  const nameWithoutExt = extensionMatch ? extensionMatch[1] : fileName;
  const ext = extensionMatch ? extensionMatch[2] : "";
  let candidatePath = folderPrefix ? `${folderPrefix}/${fileName}` : fileName;
  let counter = 1;

  const s3 = getClient();

  while (true) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: candidatePath }));
      const nextName = `${nameWithoutExt}(${counter})${ext}`;
      candidatePath = folderPrefix ? `${folderPrefix}/${nextName}` : nextName;
      counter += 1;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404) {
        break;
      }
      throw error;
    }
  }

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: candidatePath,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(s3, command, { expiresIn });
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
