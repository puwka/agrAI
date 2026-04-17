import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseSessionToken, sessionCookieName } from "./lib/simple-session";

export async function proxy(request: NextRequest) {
  try {
    const raw = request.cookies.get(sessionCookieName())?.value;
    const token = parseSessionToken(raw);

    const { pathname } = request.nextUrl;

    if (pathname.startsWith("/dashboard")) {
      if (!token) {
        return NextResponse.redirect(new URL("/login", request.url));
      }
    }

    if (pathname.startsWith("/admin")) {
      if (!token) {
        return NextResponse.redirect(new URL("/login", request.url));
      }

      if (token.role !== "ADMIN") {
        return NextResponse.redirect(new URL("/403", request.url));
      }
    }

    if (pathname === "/login" && token) {
      const targetPath = token.role === "ADMIN" ? "/admin" : "/dashboard";
      return NextResponse.redirect(new URL(targetPath, request.url));
    }

    return NextResponse.next();
  } catch (err) {
    console.error("[proxy]", err);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/dashboard/:path*", "/admin/:path*", "/login"],
};
