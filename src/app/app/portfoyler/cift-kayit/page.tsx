import { Suspense } from "react";
import Link from "@/components/ui/smart-link";
import { ArrowLeft, ArrowUpRight, Building2, CheckCircle2, FileText, Info, MapPin, Type } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { PageHeader } from "@/components/ui/page-header";
import { FilterChip } from "@/components/ui/filter-chip";
import { DataHealthCard, DataHealthCardSkeleton } from "@/components/app/data-health-card";
import { loadPropertyDataHealth, scanPropertyDuplicates } from "@/lib/duplicate-finders";
import { PROPERTY_REASON_LABEL, type PropertyMatchReason } from "@/lib/duplicate-match";
import { formatPropertyPrice, normalizePropertyCurrency } from "@/lib/property-currency";
import { propertyStatusLabel } from "@/lib/property-labels";
import { formatDateTr } from "@/lib/format";
import { PropertyGroupsClient, type PropertyGroupVM } from "./groups-client";

export const metadata = { title: "Portföy çift kayıt kontrolü" };

const SIGNALS: ReadonlyArray<{ key: PropertyMatchReason; label: string; icon: typeof MapPin }> = [
  { key: "ada-parsel", label: "Aynı ada/parsel", icon: FileText },
  { key: "adres", label: "Benzer adres", icon: MapPin },
  { key: "baslik", label: "Benzer başlık", icon: Type },
];

const BASE = "/app/portfoyler/cift-kayit";

/**
 * Portföy çift kayıt kontrolü (veri kalitesi). Aynı mülk iki kez girildiğinde (portal aktarımı + elle giriş, iki
 * danışman) fotoğraf, portal ilanı, randevu, teklif ve fiyat geçmişi ikiye bölünür. Tarama giriş anı uyarısıyla aynı
 * kuralı kullanır (aynı mahallede ada/parsel, benzer adres, benzer başlık; aynı işlem türü). Birleştirme hiçbir zaman
 * otomatik değildir: sihirbazda ana kayıt + alan seçimi + özet + onay (merge_properties, tek transaction).
 * ?sinyal= listeyi daraltır; KPI'lar tam kümeden sayılır. Veri sağlığı kartı akışla gelir.
 */
export default async function PropertyDuplicatesPage({ searchParams }: { searchParams?: Promise<{ sinyal?: string }> }) {
  const [{ tenantId, perms }, sp] = await Promise.all([requireModulePage("properties"), searchParams]);
  const signal = SIGNALS.find((s) => s.key === sp?.sinyal)?.key ?? null;
  const canMerge = (perms.properties ?? []).includes("delete");
  const supabase = await createClient();
  const scan = tenantId ? await scanPropertyDuplicates(supabase, tenantId) : { groups: [], scanned: 0, truncated: false };

  const groups = "error" in scan ? [] : scan.groups;
  const byReason = (r: PropertyMatchReason) => groups.filter((g) => g.reasons.includes(r)).length;
  const affected = new Set(groups.flatMap((g) => g.records.map((r) => r.id))).size;
  const shown = signal ? groups.filter((g) => g.reasons.includes(signal)) : groups;

  const vm: PropertyGroupVM[] = shown.map((g) => ({
    key: g.key,
    reasons: g.reasons.map((r) => PROPERTY_REASON_LABEL[r]),
    strong: g.reasons.includes("ada-parsel") || g.reasons.includes("adres"),
    records: g.records.map((r) => ({
      id: r.id,
      code: r.code,
      title: r.title || "Başlıksız ilan",
      address: r.address,
      price: formatPropertyPrice(r.price, r.transaction, normalizePropertyCurrency(r.currency) ?? "TRY"),
      status: propertyStatusLabel(r.status),
      advisor: r.advisor,
      created: formatDateTr(r.createdAt),
      mediaCount: r.mediaCount,
      hasLocation: r.hasLocation,
      score: r.completeness,
    })),
  }));

  const kpis = [
    { label: "Etkilenen ilan", value: affected, icon: Building2, href: BASE },
    ...SIGNALS.map((s) => ({ label: s.label, value: byReason(s.key), icon: s.icon, href: `${BASE}?sinyal=${s.key}` })),
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/app/portfoyler"
        className="focus-ring inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Portföylere dön
      </Link>

      <PageHeader
        title="Portföy çift kayıt kontrolü"
        eyebrow="Veri kalitesi"
        description="Aynı mülkün birden çok kez girilmesi fotoğrafları, portal ilanlarını, randevuları ve teklifleri ikiye böler. Olası kopyaları inceleyin, emin olduklarınızı birleştirin."
      />

      <section className="theme-dark relative overflow-hidden rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-4 text-white sm:p-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {kpis.map((k) => (
            <Link
              key={k.label}
              href={k.href}
              className="focus-ring press lift group block min-h-11 rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-3 backdrop-blur transition hover:border-brand-300"
            >
              <div className="flex items-start justify-between">
                <k.icon className="h-4 w-4 text-amber-400" />
                <ArrowUpRight className="h-4 w-4 text-white/40 transition group-hover:text-white" />
              </div>
              <p className="numeric mt-2 font-display text-lg font-extrabold text-white">{k.value}</p>
              <p className="text-xs text-white/60">{k.label}</p>
            </Link>
          ))}
        </div>
      </section>

      {groups.length > 0 ? (
        <nav aria-label="Sinyal türü" className="flex flex-wrap gap-2">
          <FilterChip href={BASE} active={!signal} count={groups.length}>
            Tümü
          </FilterChip>
          {SIGNALS.map((s) => (
            <FilterChip key={s.key} href={`${BASE}?sinyal=${s.key}`} active={signal === s.key} count={byReason(s.key)}>
              {s.label}
            </FilterChip>
          ))}
        </nav>
      ) : null}

      {"error" in scan ? (
        <p className="rounded-[var(--radius-card)] border border-danger-500/30 bg-danger-500/5 px-4 py-3 text-sm text-danger-600" role="alert">
          {scan.error} Lütfen sayfayı yenileyin.
        </p>
      ) : groups.length === 0 ? (
        <div className="grid place-items-center rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-[var(--radius-panel)] bg-mint-500/12 text-mint-600">
            <CheckCircle2 className="h-8 w-8" />
          </span>
          <h2 className="mt-5 font-display text-xl font-bold text-ink-950">Olası çift portföy bulunamadı</h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-text-muted">
            {scan.scanned} ilan aynı mahallede ada/parsel, adres ve başlık benzerliğine göre tarandı. Mahallesi seçilmemiş
            ilanlar ilçe içinde karşılaştırılır; konum bilgisi eksik ilanları aşağıdaki veri sağlığı kartından tamamlayın.
          </p>
        </div>
      ) : vm.length === 0 ? (
        <div className="grid place-items-center rounded-[var(--radius-panel)] border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
          <CheckCircle2 className="h-8 w-8 text-mint-600" />
          <h2 className="mt-3 font-display text-lg font-bold text-ink-950">Bu sinyalde olası kopya yok</h2>
          <Link href={BASE} className="focus-ring mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-brand-600 hover:underline">
            Tüm sinyalleri göster
          </Link>
        </div>
      ) : (
        <PropertyGroupsClient groups={vm} canMerge={canMerge} />
      )}

      {"error" in scan || !scan.truncated ? null : (
        <p className="text-xs text-text-faint">
          En yeni {scan.scanned} ilan tarandı; daha eski ilanlar bu taramaya girmedi.
        </p>
      )}

      {tenantId ? (
        <Suspense fallback={<DataHealthCardSkeleton />}>
          <PropertyDataHealth tenantId={tenantId} />
        </Suspense>
      ) : null}

      <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-line bg-canvas px-4 py-3 text-xs leading-relaxed text-text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
        <span>
          Aynı ada/parsel, aynı binadaki farklı daireler için de görülebilir: kat, m² ve fotoğraflara bakarak karar verin.
          Birleştirme; fotoğraflar, portal ilanları, randevu, teklif, anlaşma, sözleşme, görev, anahtar ve fiyat geçmişi dahil
          kopyaya bağlı <strong>tüm</strong> kayıtları ana ilana taşıyan <strong>geri alınamaz</strong> bir işlemdir. Ana
          ilanın kapak fotoğrafı korunur, taşınan fotoğraflar sona eklenir. Aynı mülk olmadığından eminseniz{" "}
          <strong>Bu grup mükerrer değil</strong> ile grubu bu cihazda gizleyebilirsiniz.
        </span>
      </p>
    </div>
  );
}

/** Veri sağlığı (konumsuz / mahallesiz ilanlar) — sayfayı bekletmeden akışla gelir. */
async function PropertyDataHealth({ tenantId }: { tenantId: string }) {
  const supabase = await createClient();
  const items = await loadPropertyDataHealth(supabase, tenantId);
  return <DataHealthCard title="Portföy veri sağlığı" items={items} />;
}
