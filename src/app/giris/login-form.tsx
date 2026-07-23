"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, type AuthResult } from "@/app/actions/auth";

const initial: AuthResult = {};

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-[16px] border border-line bg-surface p-8">
        <Link href="/" className="text-lg font-semibold text-ink-950">
          EmlakSoft
        </Link>
        <h1 className="mt-6 text-2xl font-semibold text-ink-950">Giriş yap</h1>
        <p className="mt-2 text-sm text-text-muted">
          Ofis çalışma alanınıza giriş yapın.
        </p>
        <form action={action} className="mt-8 space-y-4">
          <input type="hidden" name="next" value={next} />
          <div>
            <label className="mb-1.5 block text-sm text-text-muted" htmlFor="email">
              E-posta
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="w-full rounded-[8px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              placeholder="ornek@ofis.com"
            />
          </div>
          <div>
            <label
              className="mb-1.5 block text-sm text-text-muted"
              htmlFor="password"
            >
              Şifre
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="w-full rounded-[8px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
          {state.error ? (
            <p className="text-sm text-red-600" role="alert">
              {state.error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center rounded-[8px] bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-60"
          >
            {pending ? "Giriş yapılıyor…" : "Giriş yap"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-text-muted">
          Hesabınız yok mu?{" "}
          <Link href="/kayit" className="text-brand-600 hover:underline">
            14 gün ücretsiz deneyin
          </Link>
        </p>
      </div>
    </div>
  );
}
