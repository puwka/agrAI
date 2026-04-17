import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const FALLBACK_AUTH_SECRET = "agr-ai-emergency-auth-secret-change-me";

export async function proxy(request: NextRequest) {
  try {
    let token: Awaited<ReturnType<typeof getToken>> = null;
    try {
      token = await getToken({
        req: request,
        secret: process.env.NEXTAUTH_SECRET?.trim() || FALLBACK_AUTH_SECRET,
      });
    } catch (err) {
      console.error("[proxy] getToken:", err);
    }

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
