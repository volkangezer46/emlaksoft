import Link from "next/link";
import { cookies } from "next/headers";
import type { ComponentProps } from "react";
import type { RegisterForm } from "../register-form";
import { REGISTRATION_CLOSED_MESSAGE } from "@/lib/platform-setting-keys";
import { normalizeBillingCycle, normalizePlanId } from "@/lib/billing/plans";
import { getPublicPricing } from "@/lib/billing/public-pricing";
import { getLiveSiteContent } from "@/lib/site-content/store";
import { REF_COOKIE, REFERRAL_CODE_LENGTH, parseRefCookie, parseRefParam } from "@/lib/growth/attribution";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";
import { readInvitePreview } from "@/lib/growth/engine";
import { createClient } from "@/lib/supabase/server";
import { tx } from "@/lib/site-content/tokens";

export type RegisterSearchParams = {
  plan?: string;
  cycle?: string;
  seats?: string;
  ref?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
};

type RegisterFormProps = ComponentProps<typeof RegisterForm>;

/**
 * Kayıt sihirbazının sunucu verisi (fiyat, deneme günü, davet önizlemesi, atıf) — `/kayit` ve
 * Google ile tamamlama (`/kayit/tamamla`) AYNI kaynaktan beslenir.
 */
export async function loadRegisterFormProps(params: RegisterSearchParams): Promise<RegisterFormProps> {
  const [{ plans, trialDays, offers, efValuationCost, efLive }, content] = await Promise.all([
    getPublicPricing(),
    getLiveSiteContent(),
  ]);
  const tokenCtx = { trialDays, plans, efLive };
  // Davet bağlantısı (çerez ya da ?ref): "X sizi davet etti" + hoş geldin avantajı. Hata/kapalı program = banner yok.
  const jar = await cookies();
  const touch = parseRefCookie(jar.get(REF_COOKIE)?.value) ?? parseRefParam(params.ref);
  // Anon RPC: kod tam uzunlukta olmalı ve IP başına hız sınırı (kod tarama/ofis adı sızdırma koruması). Hata = banner yok.
  const previewAllowed =
    touch?.kind === "referral" && touch.code.length === REFERRAL_CODE_LENGTH
      ? (await checkRateLimit(`invite-preview:${await clientIp()}`, { limit: 30, windowSec: 600, failurePolicy: "deny" })).allowed
      : false;
  const preview = previewAllowed && touch?.kind === "referral" ? await readInvitePreview(await createClient(), touch.code) : null;
  return {
    copy: {
      title: tx(content.register.title, tokenCtx),
      text: tx(content.register.text, tokenCtx),
      panelText: tx(content.register.panelText, tokenCtx),
    },
    plans,
    trialDays,
    offers,
    efValuationCost,
    efLive,
    initialPlan: normalizePlanId(params.plan),
    initialCycle: normalizeBillingCycle(params.cycle),
    initialSeats: /^\d{1,3}$/.test(params.seats ?? "") && Number(params.seats) > 0 ? Number(params.seats) : undefined,
    invite: preview ? { officeName: preview.office_name, welcomeCreditTry: preview.welcome_credit_try } : null,
    attribution: {
      ref: params.ref,
      utm_source: params.utm_source,
      utm_medium: params.utm_medium,
      utm_campaign: params.utm_campaign,
    },
  };
}

/** Platform ayarı "kayıt kapalı" iken gösterilen ekran (mevcut kullanıcı girişi açık kalır). */
export function RegistrationClosed({ action }: { action?: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-16">
      <div className="w-full max-w-md rounded-[var(--radius-panel)] border border-line bg-surface p-8 text-center shadow-[var(--shadow-xs)]">
        <h1 className="font-display text-2xl font-extrabold text-ink-950">Kayıtlar geçici olarak kapalı</h1>
        <p className="mt-3 text-sm leading-relaxed text-text-muted">{REGISTRATION_CLOSED_MESSAGE}</p>
        {action ?? (
          <Link
            href="/giris"
            className="mt-6 inline-flex min-h-[42px] items-center rounded-[var(--radius-control)] bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            Giriş yap
          </Link>
        )}
      </div>
    </main>
  );
}
