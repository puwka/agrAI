import { createHmac, timingSafeEqual } from "node:crypto";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "USER";
};

type SessionPayload = SessionUser & {
  exp: number;
};

const SESSION_COOKIE = "agrai_session";
const FALLBACK_SECRET = "agr-ai-emergency-auth-secret-change-me";
const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  return process.env.NEXTAUTH_SECRET?.trim() || FALLBACK_SECRET;
}

function b64url(input: Buffer | string) {
  return Buffer.from(input).toString("base64url");
}

function fromB64url(input: string) {
  return Buffer.from(input, "base64url");
}

function sign(data: string) {
  return createHmac("sha256", getSecret()).update(data).digest("base64url");
}

export function createSessionToken(user: SessionUser) {
  const payload: SessionPayload = {
    ...user,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  const data = b64url(JSON.stringify(payload));
  const sig = sign(data);
  return `${data}.${sig}`;
}

export function parseSessionToken(token: string | undefined | null): SessionUser | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  if (!data || !sig) return null;

  const expected = sign(data);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fromB64url(data).toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }

  if (!payload?.id || !payload?.email || !payload?.name || !payload?.role) return null;
  if (payload.role !== "ADMIN" && payload.role !== "USER") return null;
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;

  return {
    id: payload.id,
    email: payload.email,
    name: payload.name,
    role: payload.role,
  };
}

export function sessionCookieName() {
  return SESSION_COOKIE;
}

