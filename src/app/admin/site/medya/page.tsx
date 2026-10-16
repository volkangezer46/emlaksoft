import Link from "@/components/ui/smart-link";
import { AlertTriangle, ImageIcon } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Button } from "@/components/ui/button";
import { requirePlatformModule } from "@/lib/platform";
import { siteContentStore } from "@/lib/site-content/store";
import { heroBudget, isLargeOutput, kb, SITE_MEDIA_LIMITS } from "@/lib/site-media/quota";
import { listSiteMedia } from "@/lib/site-media/store";
import { computeUsage, usageLabel } from "@/lib/site-media/usage";
import { MediaLibrary, type MediaCard } from "./media-library";

export const metadata = { title: "Medya" };

const FILTERS = [
  { id: "", label: "Tümü" },
  { id: "kullanilmayan", label: "Kullanılmayanlar" },
  { id: "buyuk", label: "Büyük dosyalar" },
] as const;
type FilterId = (typeof FILTERS)[number]["id"];

const norm = (v: string) => v.toLocaleLowerCase("tr").normalize("NFC");

function hrefFor(q: string, filter: FilterId) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (filter) p.set("filtre", filter);
  const s = p.toString();
  return s ? `/admin/site/medya?${s}` : "/admin/site/medya";
}

/**
 * Medya kütüphanesi: ana sayfa görselleri (bu turda hero). Izgara, arama (alt metin/başlık), "kullanılmayanlar" ve
 * "büyük dosya" süzgeçleri URL'de (iki yönlü filtre kontratı), alt metin düzenleme, Değiştir (kimlik sabit), Sil
 * (kullanımdaysa kapalı). Kullanım yayın/taslak yapılandırmasından o an hesaplanır. Tablo yokken "kurulum bekliyor".
 * Yazma süper admin; operasyon salt okur (site içeriğiyle aynı modül).
 */
export default async function AdminSiteMediaPage({ searchParams }: { searchParams: Promise<{ q?: string | string[]; filtre?: string | string[] }> }) {
  const staff = await requirePlatformModule("sitecontent");
  const canWrite = staff.role === "super_admin";
  const sp = await searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 80);
  const filter: FilterId = FILTERS.some((f) => f.id === sp.filtre) ? (sp.filtre as FilterId) : "";

  const [list, state] = await Promise.all([listSiteMedia(), siteContentStore.readState()]);

  const header = (
    <AdminPageHeader
      art="layers"
      eyebrow="Herkese açık site"
      icon={ImageIcon}
      title="Medya"
      description="Ana sayfada kullanılan görseller. Yüklenen her görsel güvenli biçimde yeniden işlenir (konum ve kamera bilgisi silinir), hafif AVIF/WebP boyutları üretilir. Alt metin zorunludur; kullanımdaki görsel silinemez, “Değiştir” ile aynı yerde yenilenir."
      glow="brand"
    />
  );

  if (list.status !== "ok") {
    return (
      <div className="space-y-6">
        {header}
        <p role="status" className="flex items-start gap-2 rounded-[var(--radius-panel)] border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {list.status === "missing"
            ? "Medya kütüphanesi kurulum bekliyor: veritabanı güncellemesi (20261013003500_site_media) henüz uygulanmadı. Bu sürede ana sayfa görselsiz, bugünkü haliyle çalışır."
            : list.error}
        </p>
      </div>
    );
  }

  const usage = computeUsage({ live: state.live, draft: state.draft });
  const all: MediaCard[] = list.items.map((m) => ({
    ...m,
    usage: (usage.get(m.id) ?? []).map(usageLabel),
    heroBytes: heroBudget(m.variants).bytes,
    heroOver: heroBudget(m.variants).over,
    large: isLargeOutput(m.variants),
  }));
  const counts: Record<FilterId, number> = {
    "": all.length,
    kullanilmayan: all.filter((m) => m.usage.length === 0).length,
    buyuk: all.filter((m) => m.large).length,
  };
  const nq = norm(q);
  const shown = all
    .filter((m) => (filter === "kullanilmayan" ? m.usage.length === 0 : filter === "buyuk" ? m.large : true))
    .filter((m) => !nq || norm(`${m.alt} ${m.title ?? ""}`).includes(nq));
  const total = all.reduce((s, m) => s + m.bytes, 0);

  return (
    <div className="space-y-6">
      {header}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-panel)] border border-line bg-surface p-4" aria-label="Süzgeçler">
        <nav aria-label="Medya süzgeci" className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Link
              key={f.id || "tum"}
              href={hrefFor(q, f.id)}
              aria-current={filter === f.id ? "page" : undefined}
              className={`focus-ring rounded-full px-3 py-1.5 text-xs font-bold transition ${filter === f.id ? "bg-brand-600 text-white" : "bg-ink-950/6 text-text-muted hover:text-ink-950"}`}
            >
              {f.label} ({counts[f.id]})
            </Link>
          ))}
        </nav>
        <form method="get" action="/admin/site/medya" role="search" className="flex items-center gap-2">
          {filter ? <input type="hidden" name="filtre" value={filter} /> : null}
          <label htmlFor="medya-ara" className="sr-only">Alt metin veya başlıkta ara</label>
          <input
            id="medya-ara"
            name="q"
            defaultValue={q}
            placeholder="Alt metin veya başlıkta ara"
            className="focus-ring surface-sunken h-9 w-56 rounded-[var(--radius-control)] border border-hairline px-3 text-sm text-ink-950"
          />
          <Button type="submit" size="sm">Ara</Button>
        </form>
        <p className="w-full text-xs text-text-muted">
          Kota: <Link href={hrefFor("", "buyuk")} className="font-semibold text-brand-700 underline">{kb(total)} / {kb(SITE_MEDIA_LIMITS.totalBytes)}</Link> kullanılıyor · dosya başına en çok {kb(SITE_MEDIA_LIMITS.inputBytes)} · ilk ekran bütçesi {kb(SITE_MEDIA_LIMITS.heroBudgetBytes)} (960 px AVIF).
        </p>
      </section>
      <MediaLibrary items={shown} canWrite={canWrite} filtered={Boolean(q || filter)} clearHref={hrefFor("", "")} />
    </div>
  );
}
