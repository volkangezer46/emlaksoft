import Link from "@/components/ui/smart-link";
import { AlarmClock, Hourglass, ShieldCheck } from "lucide-react";
import { requirePlatformModule } from "@/lib/platform";
import { createAdminClient } from "@/lib/supabase/admin";
import { now } from "@/lib/clock";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { Pagination } from "@/app/admin/_components/pagination";
import { cn } from "@/lib/utils";
import {
  KVKK_STATUS_LABELS,
  KVKK_TYPE_LABELS,
  kvkkDaysLeftLabel,
  kvkkFlowHref,
  kvkkQueueHref,
  loadKvkkQueue,
  parseKvkkFilters,
  type KvkkTone,
} from "@/lib/compliance/kvkk-queue";
import { TicketsTabs } from "./tickets-tabs";

export const metadata = { title: "KVKK talepleri" };

const TONE_CLASS: Record<KvkkTone, string> = {
  late: "bg-danger-500/10 text-danger-600",
  warn: "bg-amber-400/15 text-amber-800",
  ok: "bg-mint-500/10 text-mint-700",
  closed: "bg-[var(--surface-sunken)] text-text-muted",
};

const fmtDay = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" }).format(new Date(iso)) : "—";

/**
 * KVKK TALEP KUYRUĞU: tüm ofislerin ilgili kişi başvuruları, YALNIZ META (ofis, tür, durum, oluşturma, son tarih,
 * kalan gün). Kişi adı ve içerik gösterilmez; satır ilgili ofisin Ofis 360 akışına (kapanış/dışa aktarma ya da yasal
 * kayıtlar) gider. Dosya çıktısı yalnız Raporlar sayfasındaki rapor merkezinden ("KVKK talep defteri"; ürün kararı:
 * diğer sayfalarda rapor bağlantısı yok, report-buttons-contract).
 */
export default async function KvkkQueuePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformModule("tickets");
  const f = parseKvkkFilters((await searchParams) ?? {});
  const nowMs = now();
  // service_role: tüm ofislerin talepleri (YALNIZ meta sütunlar; kişi adı/içerik okunmaz). Kapı: tickets modülü.
  const q = await loadKvkkQueue(createAdminClient(), f, nowMs);
  const filtered = Boolean(f.tur || f.durum || f.sure);
  const toggle = (patch: Partial<typeof f>) => kvkkQueueHref({ ...f, ...patch, sayfa: 1 });

  return (
    <div className="space-y-4">
      <TicketsTabs active="kvkk" />
      <AdminPageHeader
        eyebrow="Müşteri operasyon merkezi"
        icon={ShieldCheck}
        title="KVKK talepleri"
        description="Tüm ofislerin ilgili kişi başvuruları · yasal yanıt süresi 30 gün · yalnız meta veri (kişi adı ve içerik gösterilmez). Dosya çıktısı: Raporlar > KVKK talep defteri."
      />

      <KpiGrid label="KVKK özeti">
        <KpiCard layout="inline" label="Açık talep" value={q.open} href={toggle({ durum: "acik", sure: undefined })} icon={Hourglass} tone="brand" hint="Açık + işlemde" />
        <KpiCard
          layout="inline"
          tinted={q.warn > 0}
          label="7 gün içinde doluyor"
          value={q.warn}
          href={toggle({ sure: "yaklasan" })}
          icon={AlarmClock}
          tone={q.warn > 0 ? "warn" : "success"}
          attention={q.warn > 0}
          hint={q.warn > 0 ? "Yanıt süresi yaklaşıyor" : "Yaklaşan son tarih yok"}
        />
        <KpiCard
          layout="inline"
          tinted={q.late > 0}
          label="Süresi geçmiş"
          value={q.late}
          href={toggle({ sure: "gecikmis" })}
          icon={AlarmClock}
          tone={q.late > 0 ? "danger" : "success"}
          attention={q.late > 0}
          hint={q.late > 0 ? "30 günlük yasal süre aşıldı" : "Gecikmiş talep yok"}
        />
      </KpiGrid>

      <section aria-label="Süzgeçler" className="space-y-2 rounded-[var(--radius-card)] border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-text-muted">Tür</span>
          {Object.entries(KVKK_TYPE_LABELS).map(([k, label]) => (
            <FilterChip key={k} href={toggle({ tur: f.tur === k ? undefined : k })} active={f.tur === k}>
              {label}
            </FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-text-muted">Durum</span>
          <FilterChip href={toggle({ durum: f.durum === "acik" ? undefined : "acik" })} active={f.durum === "acik"}>
            Açık (tümü)
          </FilterChip>
          {Object.entries(KVKK_STATUS_LABELS).map(([k, label]) => (
            <FilterChip key={k} href={toggle({ durum: f.durum === k ? undefined : k })} active={f.durum === k}>
              {label}
            </FilterChip>
          ))}
          {f.sure ? (
            <FilterChip href={toggle({ sure: undefined })} active tone="danger">
              {f.sure === "gecikmis" ? "Süresi geçmiş" : "7 gün içinde doluyor"} ×
            </FilterChip>
          ) : null}
          {filtered ? (
            <Link href="/admin/tickets/kvkk" className="ml-auto text-xs font-semibold text-brand-600 hover:underline">
              Süzgeçleri temizle
            </Link>
          ) : null}
        </div>
      </section>

      {q.error ? (
        <EmptyState variant="compact" illustration="liste" title="KVKK talepleri okunamadı" description="Kısa süre sonra yeniden deneyin; sorun sürerse sistem sağlığını kontrol edin." />
      ) : q.rows.length === 0 ? (
        <EmptyState
          variant="compact"
          illustration="basari"
          title={filtered ? "Süzgece uyan talep yok" : "Henüz KVKK talebi yok"}
          description={filtered ? "Süzgeçleri değiştirin ya da temizleyin." : "Ofisler ilgili kişi başvurusu kaydettiğinde burada son tarihleriyle listelenir."}
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
          <table className="w-full min-w-[720px] text-sm">
            <caption className="sr-only">KVKK talepleri (en eski önce)</caption>
            <thead className="border-b border-line text-left text-xs text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Ofis</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Tür</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Durum</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Oluşturma</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Son tarih</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Kalan</th>
                <th scope="col" className="px-4 py-2.5 font-semibold"><span className="sr-only">İşlem</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {q.rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-hover">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/tenants/${r.tenantId}`} className="font-semibold text-ink-950 hover:underline">
                      {r.tenantName}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{KVKK_TYPE_LABELS[r.type] ?? r.type}</td>
                  <td className="px-4 py-2.5">{KVKK_STATUS_LABELS[r.status] ?? r.status}</td>
                  <td className="px-4 py-2.5 tabular-nums text-text-muted">{fmtDay(r.createdAt)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{fmtDay(r.deadlineAt)}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", TONE_CLASS[r.tone])}>
                      {kvkkDaysLeftLabel(r.daysLeft)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={kvkkFlowHref(r.tenantId, r.type)} className="text-xs font-semibold text-brand-600 hover:underline">
                      {r.type === "account_closure" || r.type === "data_export" ? "Kapanış akışı" : "Yasal kayıtlar"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={f.sayfa} total={q.total} hrefFor={(p) => kvkkQueueHref({ ...f, sayfa: p })} />
    </div>
  );
}
