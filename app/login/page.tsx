"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";

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

    const result = await signIn("credentials", {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
    });

    setPending(false);

    if (result?.error) {
      setError("Неверный email или пароль");
      return;
    }

    const profileResponse = await fetch("/api/profile");
    const profile = (await profileResponse.json()) as { role?: string };

    if (profile.role === "ADMIN") {
      router.push("/admin");
      router.refresh();
      return;
    }

    router.push("/dashboard");
    router.refresh();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4 py-10 text-zinc-100">
      <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-white/5 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
        <h1 className="text-2xl font-semibold text-white">Вход</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Доступ выдаёт администратор. Самостоятельная регистрация отключена.
        </p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-zinc-300">Email</span>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-violet-400/40"
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
              className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none transition focus:border-violet-400/40"
              required
            />
          </label>

          {error && <p className="text-sm text-red-300">{error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-2xl border border-violet-300/30 bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-[0_0_24px_rgba(124,58,237,0.28)] transition hover:bg-violet-500 disabled:opacity-60"
          >
            {pending ? "Входим…" : "Войти"}
          </button>
        </form>

      </div>
    </div>
  );
}
