import { NextResponse } from "next/server";

import { sessionCookieName } from "../../../../lib/simple-session";

export async function POST(request: Request) {
  const isHttps = (request.headers.get("x-forwarded-proto") ?? "http").toLowerCase() === "https";
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: sessionCookieName(),
    value: "",
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

