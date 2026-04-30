"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);

    const result = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        password,
      }),
    });
    const data = (await result.json().catch(() => null)) as { role?: string; error?: string } | null;
    setPending(false);

    if (!result.ok) {
      setError(data?.error?.trim() || "Неверный email или пароль");
      return;
    }

    const role = data?.role === "ADMIN" ? "ADMIN" : "USER";
    router.replace(role === "ADMIN" ? "/admin" : "/dashboard");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f0f0f] px-4 py-10 text-zinc-100">
      <div className="w-full max-w-md rounded-[28px] border border-[#303030] bg-[#1a1a1a]/95 p-8 shadow-[0_20px_70px_rgba(0,0,0,0.4)] backdrop-blur-xl">
        <p className="text-center text-3xl font-semibold tracking-wide text-white sm:text-4xl">GPTML AI</p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-300">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-white/35"
              required
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-300">Пароль</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-white/35"
              required
            />
          </label>

          {error && <p className="text-sm text-red-300">{error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-2xl border border-white/25 bg-[#27272a] px-4 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(124,58,237,0.28)] transition hover:bg-[#303030] disabled:opacity-60"
          >
            {pending ? "Входим…" : "Войти"}
          </button>
        </form>

      </div>
    </div>
  );
}

