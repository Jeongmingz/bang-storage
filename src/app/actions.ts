"use server";

import { revalidatePath } from "next/cache";

import {
  clearSession,
  isAuthenticated,
  persistSession,
  verifyPassword,
} from "@/lib/auth";
import {
  createFolder,
  createSignedDownloadUrl,
  deleteFile,
  deleteFolder,
  getBucketLabel,
  listEntries,
  uploadBuffer,
} from "@/lib/storage";

export type ActionResult<T = Record<string, unknown>> =
  | ({ success: true; message?: string } & T)
  | { success: false; message: string };

const UNAUTHORIZED_MESSAGE = "세션이 만료되었습니다. 다시 로그인하세요.";

async function ensureAuth(): Promise<ActionResult | true> {
  if (!(await isAuthenticated())) {
    await clearSession();
    return { success: false, message: UNAUTHORIZED_MESSAGE };
  }

  return true;
}

export async function authenticate(formData: FormData): Promise<ActionResult> {
  const password = formData.get("password");

  if (typeof password !== "string" || password.length === 0) {
    return { success: false, message: "비밀번호를 입력하세요." };
  }

  if (!verifyPassword(password)) {
    return { success: false, message: "비밀번호가 올바르지 않습니다." };
  }

  await persistSession();
  revalidatePath("/");

  return { success: true, message: "환영합니다." };
}

export async function logout(): Promise<ActionResult> {
  await clearSession();
  revalidatePath("/");
  return { success: true, message: "로그아웃했습니다." };
}

export async function uploadFiles(formData: FormData): Promise<ActionResult<{ snapshot: Awaited<ReturnType<typeof listEntries>> }>> {
  const auth = await ensureAuth();
  if (auth !== true) {
    return auth as ActionResult<{ snapshot: Awaited<ReturnType<typeof listEntries>> }>;
  }

  const folder = formData.get("folder");
  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (files.length === 0) {
    return { success: false, message: "업로드할 파일을 선택하세요." };
  }

  try {
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      await uploadBuffer({
        fileName: file.name,
        folder: typeof folder === "string" ? folder : undefined,
        buffer,
        contentType: file.type || undefined,
      });
    }
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "업로드 중 오류가 발생했습니다.",
    };
  }

  const path = typeof folder === "string" ? folder : undefined;
  const updated = await listEntries(path);
  revalidatePath("/");

  return {
    success: true,
    message: `${files.length}개의 파일을 업로드했습니다.`,
    snapshot: updated,
  };
}

export async function deleteFileAction(path: string, currentFolder?: string): Promise<ActionResult<{ snapshot: Awaited<ReturnType<typeof listEntries>> }>> {
  const auth = await ensureAuth();
  if (auth !== true) {
    return auth as ActionResult<{ snapshot: Awaited<ReturnType<typeof listEntries>> }>;
  }

  try {
    await deleteFile(path);
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "삭제에 실패했습니다.",
    };
  }

  const updated = await listEntries(currentFolder);
  revalidatePath("/");

  return { success: true, message: "파일을 삭제했습니다.", snapshot: updated };
}

export async function generateDownloadLink(path: string): Promise<ActionResult<{ url: string }>> {
  const auth = await ensureAuth();
  if (auth !== true) {
    return auth as ActionResult<{ url: string }>;
  }

  try {
    const url = await createSignedDownloadUrl(path);
    return { success: true, url, message: "다운로드 URL을 만들었습니다." };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "URL 생성에 실패했습니다.",
    };
  }
}

export async function refreshFiles(folder?: string): Promise<ActionResult<{ snapshot: Awaited<ReturnType<typeof listEntries>>; bucket: string }>> {
  const auth = await ensureAuth();
  if (auth !== true) {
    return auth as ActionResult<{ snapshot: Awaited<ReturnType<typeof listEntries>>; bucket: string }>;
  }

  try {
    const [snapshot, bucket] = await Promise.all([listEntries(folder), Promise.resolve(getBucketLabel())]);
    return { success: true, snapshot, bucket };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "파일을 새로고침하지 못했습니다.",
    };
  }
}

export async function createFolderAction(formData: FormData): Promise<ActionResult<{ snapshot: Awaited<ReturnType<typeof listEntries>> }>> {
  const auth = await ensureAuth();
  if (auth !== true) {
    return auth as ActionResult<{ snapshot: Awaited<ReturnType<typeof listEntries>> }>;
  }

  const name = formData.get("name");
  const parent = formData.get("parent");

  if (typeof name !== "string" || name.trim().length === 0) {
    return { success: false, message: "폴더 이름을 입력하세요." };
  }

  try {
    await createFolder({ name, parent: typeof parent === "string" ? parent : undefined });
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "폴더를 만들지 못했습니다.",
    };
  }

  const snapshot = await listEntries(typeof parent === "string" ? parent : undefined);
  revalidatePath("/");
  return { success: true, message: "폴더를 만들었어요.", snapshot };
}

export async function deleteFolderAction(path: string): Promise<ActionResult<{ snapshot: Awaited<ReturnType<typeof listEntries>> }>> {
  const auth = await ensureAuth();
  if (auth !== true) return auth as ActionResult<{ snapshot: Awaited<ReturnType<typeof listEntries>> }>;

  try {
    await deleteFolder(path);
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : "폴더를 삭제하지 못했습니다.",
    };
  }

  const parent = path.split("/").slice(0, -1).join("/");
  const snapshot = await listEntries(parent || undefined);
  revalidatePath("/");
  return { success: true, message: "폴더를 삭제했습니다.", snapshot };
}
