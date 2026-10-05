import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, BadgeCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now, trDayKey } from "@/lib/clock";
import { PageHeader } from "@/components/ui/page-header";
import { StatRow } from "@/components/ui/stat-row";
import { EmptyStateV3 } from "@/components/ui/empty-state-v3";
import { loadOfficeDocAlerts } from "@/lib/advisor/advisor-store";
import { DOC_KIND_LABEL, formatDocCountdown, type DocKind } from "@/lib/advisor/advisor-profile";
import { cn } from "@/lib/utils";

export const metadata = { title: "Belge takibi" };

type Sp = Record<string, string | string[] | undefined>;

const DURUMLAR = [
  { key: "hepsi", label: "Tümü" },
  { key: "suresi_doldu", label: "Süresi dolmuş" },
  { key: "7", label: "7 gün içinde" },
  { key: "30", label: "30 gün içinde" },
] as const;
type Durum = (typeof DURUMLAR)[number]["key"];

function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function href(durum: Durum, belge: string): string {
  const q = new URLSearchParams();
  if (durum !== "hepsi") q.set("durum", durum);
  if (belge) q.set("belge", belge);
  const s = q.toString();
  return s ? `/app/ekip/belgeler?${s}` : "/app/ekip/belgeler";
}

function dateTr(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Ofis geneli danışman belge takibi (Taşınmaz Ticareti Yetki Belgesi, SPK). Süresi dolmuş ve 30 gün içinde bitenler;
 * `?durum=suresi_doldu|7|30` ve `?belge=authority|spk` ile süzülür. Yalnız ofis sahibi ve genel müdür.
 */
export default async function BelgeTakibiPage({ searchParams }: { searchParams?: Promise<Sp> }) {
  const ctx = await requireModulePage("team", "/app/ekip");
  if (!ctx.tenantId || (ctx.role !== "owner" && ctx.role !== "gm")) redirect("/app/ekip");

  const sp = (await searchParams) ?? {};
  const durumRaw = one(sp.durum);
  const durum: Durum = DURUMLAR.some((d) => d.key === durumRaw) ? (durumRaw as Durum) : "hepsi";
  const belgeRaw = one(sp.belge);
  const belge: DocKind | "" = belgeRaw === "authority" || belgeRaw === "spk" ? belgeRaw : "";

  const supabase = await createClient();
  const res = await loadOfficeDocAlerts(supabase, ctx.tenantId, trDayKey(now()));

  const header = (
    <PageHeader
      eyebrow="Ekip & yetkiler"
      title="Belge takibi"
      description="Danışmanların yetki ve SPK belgelerinin bitiş tarihleri. Bitişe 30 ve 7 gün kala uyarı görünür."
    />
  );

  if (!res.available) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyStateV3
          title="Belge takibi bu ortamda henüz etkin değil"
          description="Danışman iş profili veritabanı güncellemesi uygulandığında belge bitiş uyarıları burada listelenir."
        />
      </div>
    );
  }

  const all = res.data;
  const byKind = belge ? all.filter((a) => a.kind === belge) : all;
  const expired = byKind.filter((a) => a.state === "expired");
  const week = byKind.filter((a) => a.state === "week");
  const within30 = byKind.filter((a) => a.state === "week" || a.state === "month");
  const rows = durum === "suresi_doldu" ? expired : durum === "7" ? week : durum === "30" ? within30 : byKind;

  return (
    <div className="space-y-6">
      {header}
      <StatRow
        label="Belge durumu"
        items={[
          { label: "Süresi dolmuş", value: expired.length, href: href("suresi_doldu", belge), attention: true },
          { label: "7 gün içinde bitiyor", value: week.length, href: href("7", belge), attention: true },
          { label: "30 gün içinde bitiyor", value: within30.length, href: href("30", belge) },
        ]}
      />

      <nav aria-label="Belge süzgeçleri" className="flex flex-wrap gap-2">
        {DURUMLAR.map((d) => (
          <Link
            key={d.key}
            href={href(d.key, belge)}
            aria-current={d.key === durum ? "page" : undefined}
            className={cn(
              "focus-ring press rounded-full px-3.5 py-1.5 text-sm font-semibold transition",
              d.key === durum ? "bg-surface-selected text-brand-700 ring-1 ring-inset ring-brand-600/25" : "text-text-muted hover:bg-surface-hover",
            )}
          >
            {d.label}
          </Link>
        ))}
        <span className="mx-1 hidden w-px bg-line sm:block" aria-hidden />
        {([["", "Tüm belgeler"], ["authority", DOC_KIND_LABEL.authority], ["spk", DOC_KIND_LABEL.spk]] as const).map(([key, label]) => (
          <Link
            key={key || "all"}
            href={href(durum, key)}
            aria-current={key === belge ? "page" : undefined}
            className={cn(
              "focus-ring press rounded-full px-3.5 py-1.5 text-sm font-semibold transition",
              key === belge ? "bg-surface-selected text-brand-700 ring-1 ring-inset ring-brand-600/25" : "text-text-muted hover:bg-surface-hover",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <EmptyStateV3
          icon={BadgeCheck}
          title={all.length === 0 ? "Yaklaşan belge bitişi yok" : "Bu süzgece uyan belge yok"}
          description={all.length === 0 ? "Önümüzdeki 30 gün içinde biten veya süresi dolmuş belge bulunmuyor." : "Süzgeci değiştirerek diğer belgeleri görebilirsiniz."}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li key={`${a.profileId}-${a.kind}`}>
              <Link
                href={`/app/ekip/${a.profileId}?sekme=profil`}
                className="focus-ring press group flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3 transition hover:border-brand-300"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink-950 group-hover:text-brand-600">{a.fullName}</span>
                  <span className="block text-xs text-text-muted">{DOC_KIND_LABEL[a.kind]} · bitiş {dateTr(a.expiresOn)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", a.state === "month" ? "tone-warning" : "tone-danger")}>
                    {formatDocCountdown({ state: a.state, daysLeft: a.daysLeft })}
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-text-faint group-hover:text-brand-600" aria-hidden />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
