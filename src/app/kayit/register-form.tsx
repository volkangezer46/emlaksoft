"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUp, type AuthResult } from "@/app/actions/auth";
import { PhoneInput } from "@/components/ui/phone-input";

const initial: AuthResult = {};

export function RegisterForm() {
  const [state, action, pending] = useActionState(signUp, initial);

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-lg rounded-[16px] border border-line bg-surface p-8">
        <Link href="/" className="text-lg font-semibold text-ink-950">
          EmlakSoft
        </Link>
        <h1 className="mt-6 text-2xl font-semibold text-ink-950">
          14 gün ücretsiz başlayın
        </h1>
        <p className="mt-2 text-sm text-text-muted">
          Kredi kartı gerekmez. Ofisinizi birkaç dakikada açın.
        </p>
        <form action={action} className="mt-8 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm text-text-muted" htmlFor="name">
              Ad soyad
            </label>
            <input
              id="name"
              name="name"
              required
              className="w-full rounded-[8px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm text-text-muted" htmlFor="phone">
              Telefon
            </label>
            <PhoneInput
              id="phone"
              name="phone"
              className="w-full rounded-[8px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
          <div className="sm:col-span-2">
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
            />
          </div>
          <div className="sm:col-span-2">
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
              minLength={8}
              autoComplete="new-password"
              className="w-full rounded-[8px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              placeholder="En az 8 karakter"
            />
          </div>
          <div className="sm:col-span-2">
            <label
              className="mb-1.5 block text-sm text-text-muted"
              htmlFor="company"
            >
              Firma adı
            </label>
            <input
              id="company"
              name="company"
              required
              className="w-full rounded-[8px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              placeholder="Örn. Gezertaşar Emlak"
            />
          </div>
          <div className="sm:col-span-2">
            <label
              className="mb-1.5 block text-sm text-text-muted"
              htmlFor="agents"
            >
              Danışman sayısı
            </label>
            <select
              id="agents"
              name="agents"
              className="w-full rounded-[8px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
              defaultValue="2-10"
            >
              <option value="1">1 (Bağımsız)</option>
              <option value="2-10">2–10</option>
              <option value="10-50">10–50</option>
              <option value="50+">50+</option>
            </select>
          </div>
          {state.error ? (
            <p className="sm:col-span-2 text-sm text-red-600" role="alert">
              {state.error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="sm:col-span-2 flex w-full items-center justify-center rounded-[8px] bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-400 disabled:opacity-60"
          >
            {pending ? "Oluşturuluyor…" : "Çalışma alanını oluştur"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-text-muted">
          Zaten hesabınız var mı?{" "}
          <Link href="/giris" className="text-brand-600 hover:underline">
            Giriş yap
          </Link>
        </p>
      </div>
    </div>
  );
}
