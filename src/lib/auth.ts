import "server-only";

import { cookies } from "next/headers";
import { createHash, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "bang-storage-session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 14; // 14 days

function getRequiredSecret(key: string, value: string | undefined) {
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function getSessionToken() {
  const password = getRequiredSecret("STORAGE_ADMIN_PASSWORD", process.env.STORAGE_ADMIN_PASSWORD);
  return createHash("sha256").update(password).digest("hex");
}

export async function isAuthenticated() {
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(SESSION_COOKIE)?.value;
  return cookieValue === getSessionToken();
}

export async function assertAuthenticated() {
  if (!(await isAuthenticated())) {
    throw new Error("세션이 만료되었습니다. 다시 로그인하세요.");
  }
}

export async function persistSession() {
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === "production";
  cookieStore.set({
    name: SESSION_COOKIE,
    value: getSessionToken(),
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE,
    path: "/",
  });
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

export function verifyPassword(input: string) {
  const secret = getRequiredSecret("STORAGE_ADMIN_PASSWORD", process.env.STORAGE_ADMIN_PASSWORD);
  const inputBuffer = Buffer.from(input);
  const secretBuffer = Buffer.from(secret);

  if (inputBuffer.length !== secretBuffer.length) {
    return false;
  }

  return timingSafeEqual(inputBuffer, secretBuffer);
}
