import NextAuth from "next-auth";
import type { NextRequest } from "next/server";

import { authOptions } from "../../../../auth";

export const runtime = "nodejs";

const FALLBACK_AUTH_SECRET = "agr-ai-emergency-auth-secret-change-me";
const handler = NextAuth(authOptions);

function syncAuthRuntimeEnv(request: NextRequest) {
  const host = request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    process.env.NEXTAUTH_URL = `${proto}://${host}`;
  }
  if (!process.env.NEXTAUTH_SECRET?.trim()) {
    process.env.NEXTAUTH_SECRET = FALLBACK_AUTH_SECRET;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> },
) {
  syncAuthRuntimeEnv(request);
  return handler(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ nextauth: string[] }> },
) {
  syncAuthRuntimeEnv(request);
  return handler(request, context);
}
