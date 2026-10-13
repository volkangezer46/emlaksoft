import type { Metadata } from "next";
import { renderHome } from "@/app/_home/render-home";
import { getPublicPricing } from "@/lib/billing/public-pricing";
import { now } from "@/lib/clock";
import { getEfCatalog } from "@/lib/ef-credits/credit-reader";
import { verifyPreviewToken, type PreviewVerdict } from "@/lib/preview-token";
import { PREVIEW_BRIDGE_JS } from "./bridge";
import { readPreviewDraft } from "./draft";
import "@/app/marketing.css";
import "@/app/marketing-sections.css";
import "@/app/marketing-motion.css";
import "@/app/marketing-mobile.css";

/**
 * Ana sayfa TASLAK önizlemesi: /onizleme/ana-sayfa?t=<imzalı belirteç> (src/lib/preview-token.ts). Oturum istemez; belirteç
 * yalnız site içeriği taslağını salt okunur gösterir. Gerçek ana sayfa işleviyle (renderHome) gerçek paket/deneme verisiyle
 * çizilir; üstte sabit "TASLAK" şeridi. Her istekte taslak yeniden okunur (önbellek yok), dizine eklenmez
 * (metadata noindex + next.config X-Robots-Tag). Statik ana sayfa rotasına ve proxy'ye dokunmaz.
 * SANDBOX KARARI (SP6): yönetim iframe'i `sandbox="allow-scripts"` (allow-same-origin YOK) ile açar. Belirteç URL'de
 * kalır: sandbox yalnız belgenin kökenini opak yapar, iframe gezinmesi sorgu parametresini sunucuya aynen taşır ve
 * doğrulama sunucuda yapılır (çerez/oturum gerekmez). Bu yüzden belirteci httpOnly çereze taşımaya gerek yok.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Taslak önizleme",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  // Belirteç adres çubuğunda: dış bağlantılara Referer ile sızmasın.
  referrer: "no-referrer",
};

const MESSAGES: Record<Exclude<PreviewVerdict, { ok: true }>["reason"] | "stale", string> = {
  disabled: "Önizleme bağlantıları bu sunucuda kapalı (imza anahtarı tanımlı değil).",
  malformed: "Bağlantı eksik veya bozuk. Yönetim panelinden yeni bir önizleme bağlantısı alın.",
  signature: "Bağlantı doğrulanamadı. Yönetim panelinden yeni bir önizleme bağlantısı alın.",
  surface: "Bu bağlantı ana sayfa önizlemesi için değil.",
  expired: "Bağlantının süresi doldu. Yönetim panelinden yeni bir önizleme bağlantısı alın.",
  stale: "Taslak bu bağlantı oluşturulduktan sonra değişti. Güncel hali için yönetim panelinden yeni bir bağlantı alın.",
};

function Invalid({ reason }: { reason: keyof typeof MESSAGES }) {
  return (
    <main id="main-content" className="mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-3 px-4 py-16 text-center">
      <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Taslak önizleme</p>
      <h1 className="font-display text-2xl font-extrabold text-ink-950">Bu önizleme bağlantısı geçersiz</h1>
      <p className="text-sm text-text-muted">{MESSAGES[reason]}</p>
    </main>
  );
}

export default async function HomeDraftPreviewPage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const { t } = await searchParams;
  const verdict = verifyPreviewToken(typeof t === "string" ? t : null, { surface: "sitecontent", nowMs: now() });
  if (!verdict.ok) return <Invalid reason={verdict.reason} />;
  const [draft, pricing, efCatalog] = await Promise.all([readPreviewDraft(), getPublicPricing(), getEfCatalog()]);
  if (draft.hash !== verdict.draftHash) return <Invalid reason="stale" />;
  return (
    <>
      {renderHome({ content: draft.content, pricing, efCatalog, preview: true })}
      {/* Yerinde düzenleme köprüsü: yalnız yönetim iframe'inde etkin (bridge.ts); yeni sekmede hiçbir şey yapmaz. */}
      <script dangerouslySetInnerHTML={{ __html: PREVIEW_BRIDGE_JS }} />
    </>
  );
}
