import Link from "@/components/ui/smart-link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlarmClock, Hourglass, Inbox } from "lucide-react";
import { KpiCard, KpiGrid } from "@/components/ui/kpi-card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { Pagination } from "@/app/admin/_components/pagination";
import { cn } from "@/lib/utils";
import { kvkkDaysLeftLabel, type KvkkTone } from "@/lib/compliance/kvkk-queue";
import { IDENTITY_STATUS_LABELS, PLATFORM_KVKK_STATUS_LABELS, PLATFORM_KVKK_TYPE_LABELS, PLATFORM_KVKK_WARN_DAYS } from "@/lib/compliance/platform-kvkk";
import { loadPlatformKvkkQueue, parsePlatformQueueFilters, platformQueueHref } from "@/lib/compliance/platform-kvkk-service";

const TONE_CLASS: Record<KvkkTone, string> = {
  late: "bg-danger-500/10 text-danger-600",
  warn: "bg-amber-400/15 text-amber-800",
  ok: "bg-mint-500/10 text-mint-700",
  closed: "bg-[var(--surface-sunken)] text-text-muted",
};

const fmtDay = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" }).format(new Date(iso)) : "—";

const QUEUE_STATUSES = ["open", "in_progress", "completed", "rejected"] as const;

/**
 * DOĞRUDAN KVKK BAŞVURULARI (DG6): /kvkk-basvuru formundan gelen ve e-postası doğrulanmış başvurular. Liste YALNIZ meta
 * (başvuru no, tür, durum, kimlik, alınış, son tarih, kalan gün); kişi bilgisi ayrıntı sayfasındadır. En yakın son tarih
 * önce. Sayılar ve satırlar süzülmüş hedefe gider (sıfır çıkmaz metrik). Okuma servis istemcisiyle (çağıran sayfa kapılı).
 */
export async function PlatformKvkkQueueSection({
  admin,
  searchParams,
  nowMs,
}: {
  admin: SupabaseClient;
  searchParams: Record<string, string | string[] | undefined>;
  nowMs: number;
}) {
  const f = parsePlatformQueueFilters(searchParams);
  const q = await loadPlatformKvkkQueue(admin, f, nowMs);
  const filtered = Boolean(f.tur || f.durum || f.sure);
  const toggle = (patch: Partial<typeof f>) => platformQueueHref({ ...f, ...patch, sayfa: 1 });

  return (
    <>
      <KpiGrid label="Doğrudan başvuru özeti">
        <KpiCard layout="inline" label="Açık başvuru" value={q.open} href={toggle({ durum: "acik", sure: undefined })} icon={Hourglass} tone="brand" hint="Yeni + işlemde" />
        <KpiCard
          layout="inline"
          tinted={q.warn > 0}
          label={`${PLATFORM_KVKK_WARN_DAYS} gün içinde doluyor`}
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
          hint={q.late > 0 ? "30 günlük yasal süre aşıldı" : "Gecikmiş başvuru yok"}
        />
      </KpiGrid>

      <section aria-label="Süzgeçler" className="space-y-2 rounded-[var(--radius-card)] border border-line bg-surface p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-text-muted">Tür</span>
          {Object.entries(PLATFORM_KVKK_TYPE_LABELS).map(([k, label]) => (
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
          {QUEUE_STATUSES.map((k) => (
            <FilterChip key={k} href={toggle({ durum: f.durum === k ? undefined : k })} active={f.durum === k}>
              {PLATFORM_KVKK_STATUS_LABELS[k]}
            </FilterChip>
          ))}
          {f.sure ? (
            <FilterChip href={toggle({ sure: undefined })} active tone="danger">
              {f.sure === "gecikmis" ? "Süresi geçmiş" : `${PLATFORM_KVKK_WARN_DAYS} gün içinde doluyor`} ×
            </FilterChip>
          ) : null}
          {filtered ? (
            <Link href={platformQueueHref({})} className="ml-auto text-xs font-semibold text-brand-600 hover:underline">
              Süzgeçleri temizle
            </Link>
          ) : null}
        </div>
      </section>

      {q.error ? (
        <EmptyState
          variant="compact"
          illustration="liste"
          title={q.missing ? "KVKK başvuru kaydı kurulum bekliyor" : "Başvurular okunamadı"}
          description={
            q.missing
              ? "Veritabanı güncellemesi (20261014006000) uygulanınca /kvkk-basvuru formundan gelen başvurular burada listelenir."
              : "Kısa süre sonra yeniden deneyin; sorun sürerse sistem sağlığını kontrol edin."
          }
        />
      ) : q.rows.length === 0 ? (
        <EmptyState
          variant="compact"
          illustration={filtered ? "liste" : "basari"}
          icon={Inbox}
          title={filtered ? "Süzgece uyan başvuru yok" : "Henüz doğrudan KVKK başvurusu yok"}
          description={
            filtered
              ? "Süzgeçleri değiştirin ya da temizleyin."
              : "Veri sahipleri /kvkk-basvuru formundan başvurup e-postalarını doğruladığında burada 30 günlük son tarihleriyle listelenir."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-panel)] border border-line bg-surface">
          <table className="w-full min-w-[760px] text-sm">
            <caption className="sr-only">Doğrudan KVKK başvuruları (en yakın son tarih önce)</caption>
            <thead className="border-b border-line text-left text-xs text-text-muted">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Başvuru no</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Tür</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Durum</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Kimlik</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Başvuru</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Son tarih</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Kalan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {q.rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-hover">
                  <td className="px-4 py-2.5">
                    <Link href={`/admin/tickets/kvkk/${r.id}`} className="font-semibold tabular-nums text-ink-950 hover:underline">
                      {r.ref}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{PLATFORM_KVKK_TYPE_LABELS[r.type] ?? r.type}</td>
                  <td className="px-4 py-2.5">{PLATFORM_KVKK_STATUS_LABELS[r.status as keyof typeof PLATFORM_KVKK_STATUS_LABELS] ?? r.status}</td>
                  <td className="px-4 py-2.5 text-text-muted">{IDENTITY_STATUS_LABELS[r.identity as keyof typeof IDENTITY_STATUS_LABELS] ?? r.identity}</td>
                  <td className="px-4 py-2.5 tabular-nums text-text-muted">{fmtDay(r.createdAt)}</td>
                  <td className="px-4 py-2.5 tabular-nums">{fmtDay(r.dueAt)}</td>
                  <td className="px-4 py-2.5">
                    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", TONE_CLASS[r.tone])}>
                      {kvkkDaysLeftLabel(r.daysLeft)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination page={f.sayfa} total={q.total} hrefFor={(p) => platformQueueHref({ ...f, sayfa: p })} />
    </>
  );
}
