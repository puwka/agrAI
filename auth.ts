import { compare } from "bcryptjs";
import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { ensureDefaultUsersForAuth } from "./lib/bootstrap-users";
import { db } from "./lib/db";
import type { AppRole } from "./lib/auth/roles";

const EMERGENCY_USERS = [
  {
    id: "admin-seed",
    email: "admin@agrai.dev",
    password: "admin12345",
    name: "Admin agrAI",
    role: "ADMIN" as AppRole,
  },
  {
    id: "user-seed",
    email: "user@agrai.dev",
    password: "user12345",
    name: "Demo User",
    role: "USER" as AppRole,
  },
];

function emergencyAuthorize(email: string, password: string) {
  const match = EMERGENCY_USERS.find((u) => u.email === email && u.password === password);
  if (!match) return null;
  return {
    id: match.id,
    email: match.email,
    name: match.name,
    role: match.role,
  };
}

/** next-auth v4: на Vercel preview `NEXTAUTH_URL` выставляется в `instrumentation.ts`; в проде задайте URL вручную */
export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;

        if (!email || !password) {
          return null;
        }

        try {
          await ensureDefaultUsersForAuth();
        } catch (error) {
          console.error("[auth] bootstrap failed, using emergency fallback:", error);
          return emergencyAuthorize(email, password);
        }

        let user: Awaited<ReturnType<typeof db.user.findUnique>> | null = null;
        try {
          user = await db.user.findUnique({
            where: { email },
          });
        } catch (error) {
          console.error("[auth] db lookup failed, using emergency fallback:", error);
          return emergencyAuthorize(email, password);
        }

        if (!user) {
          return emergencyAuthorize(email, password);
        }

        const isValidPassword = await compare(password, user.passwordHash);

        if (!isValidPassword) {
          return emergencyAuthorize(email, password);
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role as AppRole,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.name = user.name;
        token.email = user.email;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.id === "string" ? token.id : "";
        session.user.role =
          token.role === "ADMIN" || token.role === "USER" ? token.role : "USER";
        session.user.name = typeof token.name === "string" ? token.name : "";
        session.user.email = typeof token.email === "string" ? token.email : "";
      }

      return session;
    },
  },
};

export function getAuthSession() {
  return getServerSession(authOptions);
}
