import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { hasOfficeWideDataScope } from "@/lib/team/assignable-roles";
import { now } from "@/lib/clock";
import { PageHeader } from "@/components/ui/page-header";
import { ALERT_WINDOW_DAYS, loadAlerts, type OversightAlertView } from "@/lib/oversight/load";
import { loadOversightSettings } from "@/lib/oversight/store";
import { ALERT_RULE_IDS, ALERT_RULE_META, type AlertRuleId } from "@/lib/oversight/settings";
import { SEVERITY_LABEL, type AlertSeverity } from "@/lib/oversight/alert-rules";
import { OversightNav } from "../_components/oversight-nav";
import { AlertList } from "../_components/alert-list";
import { PrivacyNote } from "../_components/privacy-note";

const PATH = "/app/ofis-kontrol/uyarilar";
const PAGE_SIZE = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEVERITIES: readonly AlertSeverity[] = ["yuksek", "orta", "bilgi"];

type Sp = { onem?: string; kural?: string; aktor?: string; durum?: string; sayfa?: string };

export default async function UyarilarPage({ searchParams }: { searchParams?: Promise<Sp> }) {
  const { tenantId, role } = await requireModulePage("dashboard", PATH);
  if (!tenantId || !hasOfficeWideDataScope(role)) redirect("/app/ofis-kontrol/benim");

  const sp = (await searchParams) ?? {};
  const onem = SEVERITIES.includes(sp.onem as AlertSeverity) ? (sp.onem as AlertSeverity) : "";
  const kural = (ALERT_RULE_IDS as readonly string[]).includes(sp.kural ?? "") ? (sp.kural as AlertRuleId) : "";
  const aktor = UUID_RE.test(sp.aktor ?? "") ? (sp.aktor as string) : "";
  const durum = sp.durum === "incelendi" ? "incelendi" : "acik";
  const sayfa = Math.max(1, Number.parseInt(sp.sayfa ?? "1", 10) || 1);

  const supabase = await createClient();
  const settings = await loadOversightSettings(supabase, tenantId);
  const data = await loadAlerts(supabase, tenantId, settings.thresholds, now());

  const href = (patch: Partial<Record<keyof Sp, string | null>>) => {
    const next: Sp = { onem, kural, aktor, durum: durum === "acik" ? "" : durum, ...patch } as Sp;
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) q.set(k, String(v));
    const s = q.toString();
    return s ? `${PATH}?${s}` : PATH;
  };

  const base: OversightAlertView[] = durum === "incelendi" ? data.reviewed : data.open;
  const filtered = base.filter((a) => (!onem || a.severity === onem) && (!kural || a.rule === kural) && (!aktor || a.advisorId === aktor));
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(sayfa, totalPages);
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const countBy = (s: AlertSeverity) => data.open.filter((a) => a.severity === s).length;
  const disabledRules = ALERT_RULE_IDS.filter((r) => !settings.thresholds.enabled[r] || !ALERT_RULE_META[r].sourceAvailable);

  const chip = (active: boolean) =>
    `focus-ring press rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
      active ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-surface text-text-muted hover:border-brand-300 hover:text-brand-600"
    }`;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Ofis Kontrol Merkezi"
        title="Uyarılar"
        description={`Son ${ALERT_WINDOW_DAYS} günün kayıtlarından kurallarla üretilir. Her uyarı nedenini açıklar, ilgili kayda götürür ve “incelendi” işaretlenince bir daha uyarı üretmez.`}
      />
      <OversightNav active="uyarilar" office openAlerts={data.open.length} />

      <div className="flex flex-wrap items-center gap-2">
        <Link href={href({ durum: "", sayfa: null })} aria-current={durum === "acik" ? "page" : undefined} className={chip(durum === "acik")}>
          Açık ({data.open.length})
        </Link>
        <Link href={href({ durum: "incelendi", sayfa: null })} aria-current={durum === "incelendi" ? "page" : undefined} className={chip(durum === "incelendi")}>
          İncelenen ({data.reviewed.length})
        </Link>
        <span className="mx-1 h-4 w-px bg-line" aria-hidden />
        {SEVERITIES.map((s) => (
          <Link key={s} href={href({ onem: onem === s ? "" : s, sayfa: null })} className={chip(onem === s)}>
            {SEVERITY_LABEL[s]} ({countBy(s)})
          </Link>
        ))}
        {kural ? (
          <Link href={href({ kural: "", sayfa: null })} className={chip(true)}>
            {ALERT_RULE_META[kural].label} ×
          </Link>
        ) : null}
        {aktor ? (
          <Link href={href({ aktor: "", sayfa: null })} className={chip(true)}>
            {data.names.get(aktor) ?? "Danışman"} ×
          </Link>
        ) : null}
      </div>

      {!data.reviewsAvailable ? (
        <p className="rounded-[var(--radius-control)] border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-800">
          “İncelendi” kaydı henüz etkin değil (veritabanı güncellemesi bekleniyor). Uyarılar görüntülenir; işaretleme güncelleme sonrası açılır.
        </p>
      ) : null}
      {data.partial ? (
        <p className="text-xs text-text-muted">Tarama çok sayıda kayıt nedeniyle son kayıtlarla sınırlandı; eski olaylar eksik olabilir.</p>
      ) : null}

      <AlertList
        alerts={visible}
        names={data.names}
        advisorHref={(id) => href({ aktor: id, sayfa: null })}
        ruleHref={(r) => href({ kural: r, sayfa: null })}
        canReview
        reviewsAvailable={data.reviewsAvailable}
        emptyTitle={durum === "acik" ? "Açık uyarı yok" : "İncelenmiş uyarı yok"}
        emptyDescription={
          durum === "acik"
            ? "Kurallara takılan bir işlem görünmüyor. Eşikleri “Kurallar ve eşikler” sayfasından ayarlayabilirsiniz."
            : "İncelendi olarak işaretlenen uyarılar burada listelenir."
        }
      />

      {totalPages > 1 ? (
        <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3">
          {page > 1 ? (
            <Link href={href({ sayfa: String(page - 1) })} className={chip(false)}>
              ← Önceki
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs tabular-nums text-text-muted">
            Sayfa {page} / {totalPages} · {filtered.length} uyarı
          </span>
          {page < totalPages ? (
            <Link href={href({ sayfa: String(page + 1) })} className={chip(false)}>
              Sonraki →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}

      {disabledRules.length > 0 ? (
        <p className="text-xs text-text-muted">
          Devre dışı / veri kaynağı olmayan kurallar:{" "}
          {disabledRules.map((r, i) => (
            <span key={r}>
              {i > 0 ? ", " : ""}
              {ALERT_RULE_META[r].label}
              {!ALERT_RULE_META[r].sourceAvailable ? " (veri kaynağı yok)" : ""}
            </span>
          ))}
          .{" "}
          <Link href="/app/ofis-kontrol/kurallar" className="font-semibold text-brand-600 hover:underline">
            Kuralları düzenle
          </Link>
        </p>
      ) : null}

      <PrivacyNote audience="office" />
    </div>
  );
}
