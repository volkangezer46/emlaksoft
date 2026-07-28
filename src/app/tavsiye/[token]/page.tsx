import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { Gift, HeartHandshake, Link2Off, Phone, ShieldCheck } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatTurkishPhone, toTelHref } from "@/lib/phone";
import {
  PublicGhostButton,
  PublicStateBox,
  PublicTokenPage,
} from "@/components/public/token-page";
import { ReferralForm } from "./referral-form";

// Tavsiye linkleri kişiye özeldir → arama motorlarına kapalı (anket deseni).
export const metadata: Metadata = {
  title: "Tavsiye et",
  robots: { index: false, follow: false },
};

// Tıklanma sayacı her açılışta işlesin; sayfa önbelleğe takılmasın.
export const dynamic = "force-dynamic";

function rel<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/**
 * Referans (tavsiye) programının PUBLIC sayfası — memnun müşteri linki
 * çevresiyle paylaşır, tanıdığı kısa formu doldurur ve ofise "tavsiye" düşer.
 *
 * GÜVENLİK/GİZLİLİK: tavsiye eden müşterinin YALNIZ ADI gösterilir (telefon,
 * anlaşma, portföy bilgisi asla) — link yanlış ele geçse bile müşteri verisi
 * sızmasın (anket/açık ev deseni). RLS anon'a açık olmadığından sorgu service
 * role ile yapılır. Tıklanma sayacı after() ile yanıttan SONRA artar.
 */
export default async function ReferralPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // public_token uuid tipinde; uuid olmayan girdi sorguya gitmeden 404 olsun.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) notFound();

  const admin = createAdminClient();
  const { data: link } = await admin
    .from("referral_links")
    .select(
      "id, is_active, reward_note, customer:customers(full_name), tenant:tenants(name, phone, logo_url, brand_color)",
    )
    .eq("public_token", token)
    .maybeSingle();

  if (!link) notFound();

  type TenantShape = {
    name?: string;
    phone?: string | null;
    logo_url?: string | null;
    brand_color?: string | null;
  };
  const tenant = rel(link.tenant as TenantShape | TenantShape[] | null);
  const office = tenant?.name ?? "Emlak ofisi";
  const officePhone = tenant?.phone ?? null;
  const telHref = toTelHref(officePhone);
  const referrer = rel(link.customer as { full_name?: string } | { full_name?: string }[] | null)?.full_name ?? "Bir müşterimiz";
  const firstName = referrer.split(" ")[0] || referrer;
  const active = link.is_active !== false;
  const reward = String(link.reward_note ?? "").trim();

  // Tıklanma: yanıt gönderildikten SONRA atomik +1 (increment_presentation_view deseni).
  // Kapalı linkte sayaç şişmesin.
  if (active) {
    after(async () => {
      const { error } = await admin.rpc("increment_referral_click", { p_link_id: link.id });
      if (error) console.error("increment_referral_click", error.message);
    });
  }

  return (
    <PublicTokenPage
      office={office}
      logoUrl={tenant?.logo_url ?? null}
      brandColor={tenant?.brand_color ?? null}
      icon={HeartHandshake}
      title={`${referrer} sizi ${office} ile tanıştırıyor`}
      subtitle={`${firstName}, bizimle çalıştı ve memnun kaldı. Çevrenizde ev arayan ya da evini satmak/kiralamak isteyen biri varsa bize tanıtın; gerisini biz halledelim.`}
      purpose="Bu sayfa yalnızca tavsiye iletmek içindir"
    >
      {active ? (
        <>
          <ul className="space-y-2 text-[12px] leading-relaxed text-text-muted">
            {[
              "Aynı gün içinde arar, ne aradığını dinleriz.",
              "Baskı yok — uygun portföy yoksa açıkça söyleriz.",
              "Bilgiler yalnızca bu görüşme için kullanılır, üçüncü kişiyle paylaşılmaz.",
            ].map((t) => (
              <li
                key={t}
                className="flex items-start gap-2 rounded-[12px] border border-line bg-canvas/60 px-3.5 py-2.5"
              >
                <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-mint-600" aria-hidden="true" />
                <span>{t}</span>
              </li>
            ))}
          </ul>

          {reward ? (
            <p
              className="mt-3 flex items-start gap-2 rounded-[12px] border px-3.5 py-2.5 text-[12px] font-semibold leading-relaxed"
              style={{
                borderColor: "var(--pb-edge)",
                backgroundColor: "var(--pb-veil)",
                color: "var(--pb-ink)",
              }}
            >
              <Gift className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {reward}
            </p>
          ) : null}

          <ReferralForm token={token} office={office} officePhone={officePhone} />
        </>
      ) : (
        <PublicStateBox
          icon={Link2Off}
          title="Bu tavsiye bağlantısı kapatılmış."
          description={`Yine de bize ulaşmak isterseniz ${office} sizi memnuniyetle dinler.`}
          action={
            telHref ? (
              <PublicGhostButton href={telHref}>
                <Phone className="h-4 w-4" style={{ color: "var(--pb-ink)" }} aria-hidden="true" />
                {formatTurkishPhone(officePhone)}
              </PublicGhostButton>
            ) : null
          }
        />
      )}
    </PublicTokenPage>
  );
}
