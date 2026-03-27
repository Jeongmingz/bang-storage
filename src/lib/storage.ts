import "server-only";

import {
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

function encodeKey(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function decodeKey(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

export async function listEntries(path?: string): Promise<StorageSnapshot> {
  const prefix = normalizePath(path);
  const keyPrefix = prefix ? encodeKey(prefix) + "/" : undefined;
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
      const raw = prefixObj.Prefix.replace(keyPrefix ?? "", "").replace(/\/$/, "");
      const decodedFolder = decodeKey(raw);
      if (decodedFolder) folders.add(decodedFolder);
    }

    for (const item of Contents) {
      if (!item.Key) continue;
      const decoded = decodeKey(item.Key);
      if (decoded.endsWith("/.keep")) {
        const folderName = decoded.replace(prefix ? `${prefix}/` : "", "").replace("/.keep", "");
        if (folderName) {
          folders.add(folderName);
        }
        continue;
      }
      const relative = prefix ? decoded.replace(`${prefix}/`, "") : decoded;
      if (relative.includes("/")) {
        folders.add(relative.split("/")[0]);
        continue;
      }
      files.push({
        id: item.Key,
        name: relative,
        path: prefix ? `${prefix}/${relative}` : relative,
        size: Number(item.Size ?? 0),
        createdAt: item.LastModified?.toISOString() ?? new Date().toISOString(),
        updatedAt: item.LastModified?.toISOString() ?? new Date().toISOString(),
        publicUrl: `${ENDPOINT}/${BUCKET}/${encodeKey(prefix ? `${prefix}/${relative}` : relative)}`,
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
      Key: encodeKey(path),
    }),
  );
}

export async function deleteFolder(path: string) {
  const prefix = normalizePath(path);
  if (!prefix) throw new Error("루트는 삭제할 수 없습니다.");

  const s3 = getClient();
  const keyPrefix = encodeKey(prefix);
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
      Key: `${encodeKey(fullPath)}/.keep`,
      Body: "",
      ContentType: "text/plain",
    }),
  );
}

export async function uploadBuffer(options: {
  fileName: string;
  folder?: string;
  buffer: Buffer;
  contentType?: string;
}) {
  const { fileName, folder, buffer, contentType } = options;
  const folderPrefix = normalizePath(folder);
  const basePath = folderPrefix ? `${folderPrefix}/${fileName}` : fileName;
  const s3 = getClient();

  const extensionMatch = fileName.match(/(.*)(\.[^.]*)$/);
  const nameWithoutExt = extensionMatch ? extensionMatch[1] : fileName;
  const ext = extensionMatch ? extensionMatch[2] : "";

  let candidatePath = basePath;
  let counter = 1;

  while (true) {
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: encodeKey(candidatePath) }));
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

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: encodeKey(candidatePath),
      Body: buffer,
      ContentType: contentType,
    }),
  );
}

export async function createSignedDownloadUrl(path: string, expiresInSeconds = 60 * 5) {
  const s3 = getClient();
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: encodeKey(path) });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

export function getBucketLabel() {
  return BUCKET ?? "";
}
