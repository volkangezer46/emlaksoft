import Link from "next/link";
import { Suspense } from "react";
import { ArrowUpRight, ChevronRight, HeartPulse } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getControlSummary } from "@/lib/listing-control/server/readers";
import type { Db } from "@/lib/listing-control/server/db";
import { healthyPercent, kpiHref, sumSummaryRows, type GroupParam } from "@/components/listing-control/helpers";
import { KpiCard } from "@/components/ui/kpi-card";
import type { HomeCtx } from "./data";

/**
 * PORTFÖY SAĞLIĞI (ana ekran kartı): "Portföy sağlığı %93 · 3 kritik · 7 inceleme · 174 sağlıklı · Sorunları incele".
 * Kaynak TEK: İlan Kontrol özet RPC'si (`listing_control_summary`, property_control_state k_* bayrakları; rol kapsamı
 * RLS'te). Kapsam ana ekranla aynı: "Ben" → yönetim rolünde kendi danışman satırı, diğer rollerde zaten yalnız kendi
 * portföyleri; "Ofis" → ofis toplamı. Her sayı aynı bayrakla filtrelenmiş listeye gider (sıfır çıkmaz metrik).
 * Veri yoksa (sistem etkin değil / aktif portföy yok / portals izni yok) kart HİÇ çizilmez.
 */
export function PortfoySagligi({ ctx }: { ctx: HomeCtx }) {
  if (!ctx.tenantId || !(ctx.perms.portals ?? []).includes("view")) return null;
  return (
    <Suspense fallback={null}>
      <PortfoySagligiGovde ctx={ctx} />
    </Suspense>
  );
}

async function PortfoySagligiGovde({ ctx }: { ctx: HomeCtx }) {
  const db = (await createClient()) as unknown as Db;
  const ownRow = ctx.isManagement && ctx.scopeMine;
  const res = await getControlSummary(db, ownRow ? "advisor" : "tenant");
  if (!res.available) return null;
  const rows = ownRow ? res.rows.filter((r) => r.group_id === ctx.userId) : res.rows;
  const s = sumSummaryRows(rows);
  const pct = healthyPercent(s);
  if (s.total_active === 0 || pct === null) return null;

  const group: GroupParam = ownRow ? "danisman" : "ofis";
  const groupId = ownRow ? ctx.userId : null;
  const href = (k: "portal_missing" | "in_review" | "healthy") => kpiHref(k, group, groupId);
  const tone = pct >= 85 ? "success" : pct >= 60 ? "warn" : "danger";
  const items = [
    { key: "kritik", label: "kritik", hint: "Portal ilanı kayıp", value: s.portal_missing, href: href("portal_missing"), dot: "bg-danger-600" },
    { key: "inceleme", label: "inceleme", hint: "Açıklama bekleyen uyarı", value: s.in_review, href: href("in_review"), dot: "bg-amber-500" },
    { key: "saglikli", label: "sağlıklı", hint: "Sorunsuz ve güncel", value: s.healthy, href: href("healthy"), dot: "bg-mint-600" },
  ];

  return (
    <section aria-labelledby="portfoy-sagligi-baslik" className="ds-card ds-pad">
      <header className="ds-head mb-3">
        <span className="pm-ico pm-t-brand" aria-hidden="true">
          <HeartPulse />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="portfoy-sagligi-baslik" className="ds-title">
            Portföy sağlığı
          </h2>
          <p className="ds-sub mt-0.5">{ownRow || !ctx.isManagement ? "Kendi portföyleriniz" : "Ofis geneli"} · {s.total_active} aktif portföy</p>
        </div>
        <Link href="/app/ilan-kontrol" className="ds-link focus-ring">
          İlan Kontrol <ArrowUpRight aria-hidden="true" />
        </Link>
      </header>
      <div className="grid gap-3 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:items-center">
        <KpiCard label="Sağlıklı oranı" value={`%${pct}`} href={href("healthy")} icon={HeartPulse} tone={tone} layout="inline" hint={`${s.healthy} / ${s.total_active} portföy`} />
        <ul className="flex flex-wrap items-center gap-2">
          {items.map((it) => (
            <li key={it.key}>
              <Link href={it.href} title={it.hint} className="focus-ring inline-flex min-h-10 items-center gap-2 rounded-full border border-hairline bg-surface-raised px-3 text-sm transition hover:border-brand-400">
                <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full ${it.dot}`} />
                <span className="font-semibold tabular-nums text-text">{it.value}</span>
                <span className="text-text-muted">{it.label}</span>
              </Link>
            </li>
          ))}
          <li>
            <Link
              href={ownRow ? `/app/ilan-kontrol/anomaliler?danisman=${encodeURIComponent(ctx.userId)}` : "/app/ilan-kontrol/anomaliler"}
              className="focus-ring inline-flex min-h-10 items-center gap-1 rounded-full bg-brand-600 px-4 text-sm font-semibold text-white transition hover:bg-accent-hover"
            >
              Sorunları incele <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </Link>
          </li>
        </ul>
      </div>
    </section>
  );
}
