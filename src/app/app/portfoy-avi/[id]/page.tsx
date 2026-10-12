import { notFound, redirect } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { DAY_MS, now, trDayStartMs } from "@/lib/clock";
import { formatTry } from "@/lib/format";
import { MANAGER_ROLES } from "@/lib/team/assignable-roles";
import { buildCallScript, CALL_NOTICE } from "@/lib/prospecting/script";
import { evaluatePriceChange } from "@/lib/prospecting/price";
import { OUTCOME_LABELS, PORTAL_LABELS, type FsboOutcome } from "@/lib/prospecting/types";
import { FSBO_ROW_SELECT, type FsboRow } from "@/lib/prospecting/load";
import { toCardData } from "@/lib/prospecting/view";
import type { Db } from "@/lib/prospecting/store";
import { FsboCard } from "../fsbo-card";

export const metadata = { title: "Sahibinden ilan" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Raw = Omit<FsboRow, "districtName" | "assigneeName" | "doNotCall" | "price" | "gross_m2" | "last_price_drop_pct"> & {
  price: number | string | null;
  gross_m2: number | string | null;
  last_price_drop_pct: number | string | null;
  district: { name: string | null } | { name: string | null }[] | null;
  assignee: { full_name: string | null } | { full_name: string | null }[] | null;
};

const first = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

function dateText(iso: string): string {
  const d = new Date(Date.parse(iso) + 3 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

export default async function FsboDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const ctx = await requireModulePage("prospecting", "/app/portfoy-avi");
  if (!ctx.tenantId) redirect("/app");
  const perms = ctx.perms.prospecting ?? [];
  const canEdit = perms.includes("edit");
  const isManager = (MANAGER_ROLES as readonly string[]).includes(ctx.role);
  const canConvert = canEdit && ctx.role !== "call_center" && (ctx.perms.properties ?? []).includes("create");
  const nowMs = now();
  const supabase = (await createClient()) as Db;

  const { data: leadRaw } = await supabase.from("fsbo_leads").select(FSBO_ROW_SELECT).eq("tenant_id", ctx.tenantId).eq("id", id).is("deleted_at", null).maybeSingle();
  const raw = leadRaw as unknown as Raw | null;
  if (!raw) notFound();
  // Danışman/çağrı merkezi başkasının kaydını (kişisel veri) açamaz; yönetici ve takım lideri tümünü görür.
  if (!isManager && ctx.role !== "team_lead" && raw.assigned_to && raw.assigned_to !== ctx.userId) redirect("/app/portfoy-avi");

  const [activities, observations, tenantRow, profileRow, prevLead, customer, hashCheck] = await Promise.all([
    supabase
      .from("fsbo_lead_activities")
      .select("id, kind, outcome, note, created_at, actor:profiles!fsbo_lead_activities_actor_id_fkey(full_name)")
      .eq("tenant_id", ctx.tenantId)
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("fsbo_lead_observations").select("id, observed_at, price, listing_status").eq("tenant_id", ctx.tenantId).eq("lead_id", id).order("observed_at", { ascending: false }).limit(30),
    supabase.from("tenants").select("name, license_no").eq("id", ctx.tenantId).maybeSingle(),
    supabase.from("profiles").select("full_name").eq("id", ctx.userId).maybeSingle(),
    raw.relist_of ? supabase.from("fsbo_leads").select("id, title, price, first_seen_at").eq("tenant_id", ctx.tenantId).eq("id", raw.relist_of).maybeSingle() : Promise.resolve({ data: null }),
    raw.customer_id ? supabase.from("customers").select("id, full_name").eq("tenant_id", ctx.tenantId).eq("id", raw.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    raw.phone_hash ? supabase.from("fsbo_do_not_call").select("id").eq("tenant_id", ctx.tenantId).eq("phone_hash", raw.phone_hash).limit(1) : Promise.resolve({ data: [] }),
  ]);

  const row: FsboRow = {
    ...raw,
    price: raw.price == null ? null : Number(raw.price),
    gross_m2: raw.gross_m2 == null ? null : Number(raw.gross_m2),
    last_price_drop_pct: raw.last_price_drop_pct == null ? null : Number(raw.last_price_drop_pct),
    districtName: first(raw.district)?.name ?? null,
    assigneeName: first(raw.assignee)?.full_name ?? null,
    doNotCall: ((hashCheck.data as unknown[] | null) ?? []).length > 0,
  };
  const card = toCardData(row, nowMs);
  const office = tenantRow.data as { name: string | null; license_no: string | null } | null;
  const script = buildCallScript({
    advisorName: (profileRow.data as { full_name: string | null } | null)?.full_name ?? null,
    officeName: office?.name ?? null,
    licenseNo: office?.license_no ?? null,
    districtName: row.districtName,
    rooms: row.rooms,
    portalLabel: PORTAL_LABELS[row.portal as keyof typeof PORTAL_LABELS] ?? "ilan sitesi",
  });
  const tomorrow = new Date(trDayStartMs(nowMs) + DAY_MS + 3 * 3_600_000).toISOString().slice(0, 10);
  const prev = prevLead.data as { id: string; title: string | null; price: number | string | null; first_seen_at: string } | null;
  const cust = customer.data as { id: string; full_name: string } | null;
  const obs = ((observations.data ?? []) as { id: string; observed_at: string; price: number | string | null }[]).map((o) => ({ ...o, price: o.price == null ? null : Number(o.price) }));
  const acts = (activities.data ?? []) as unknown as { id: string; kind: string; outcome: string | null; note: string | null; created_at: string; actor: { full_name: string | null } | { full_name: string | null }[] | null }[];

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <PageHeader
        title={card.title}
        eyebrow="Sahibinden ilanlar"
        breadcrumbs={[{ label: "Sahibinden ilanlar", href: "/app/portfoy-avi" }, { label: "Kayıt" }]}
        description="İlan sahibini arayın, notlarınızı ve fiyat değişimini bu sayfadan izleyin."
      />
      <FsboCard
        data={card}
        canEdit={canEdit}
        canDelete={perms.includes("delete")}
        canConvert={canConvert}
        isManager={isManager}
        people={[]}
        script={script}
        callNotice={CALL_NOTICE}
        dayDefault={tomorrow}
      />

      {prev ? (
        <Card className="p-4 text-sm">
          <p className="font-semibold text-ink-950">Tekrar ilan</p>
          <p className="mt-1 text-text-muted">
            Daha önce kayıtlı bir ilanla bağlantılı ({dateText(prev.first_seen_at).slice(0, 10)}
            {prev.price != null ? `, ${formatTry(Number(prev.price))}` : ""}
            {row.price != null && prev.price != null ? ` → şimdi ${formatTry(row.price)}` : ""}).{" "}
            <Link href={`/app/portfoy-avi/${prev.id}`} className="font-semibold text-brand-600 hover:underline">Önceki kaydı aç</Link>
          </p>
        </Card>
      ) : null}

      {cust ? (
        <Card className="p-4 text-sm">
          <p className="font-semibold text-ink-950">Müşteri kaydı</p>
          <p className="mt-1 text-text-muted">
            <Link href={`/app/musteriler/${cust.id}`} className="font-semibold text-brand-600 hover:underline">{cust.full_name}</Link> kaydına bağlı.
          </p>
        </Card>
      ) : null}
      {row.property_id ? (
        <Card className="p-4 text-sm">
          <Link href={`/app/portfoyler/${row.property_id}`} className="font-semibold text-brand-600 hover:underline">Dönüşen portföyü aç</Link>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-ink-950">Zaman çizelgesi</h2>
          {acts.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">Henüz kayıt yok.</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {acts.map((a) => {
                const label = a.kind === "call" ? `Arama${a.outcome ? ` · ${OUTCOME_LABELS[a.outcome as FsboOutcome] ?? a.outcome}` : ""}` : a.kind === "note" ? "Not" : a.kind === "meeting" ? "Görüşme" : a.kind === "message" ? "Mesaj" : "Durum";
                return (
                  <li key={a.id} className="text-sm">
                    <p className="font-medium text-ink-950">{label}</p>
                    {a.note ? <p className="text-text-muted">{a.note}</p> : null}
                    <p className="text-xs text-text-muted">{dateText(a.created_at)}{first(a.actor)?.full_name ? ` · ${first(a.actor)?.full_name}` : ""}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-ink-950">Fiyat geçmişi</h2>
          {obs.length === 0 ? (
            <p className="mt-2 text-sm text-text-muted">Henüz gözlem yok.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {obs.map((o, i) => {
                const older = obs[i + 1];
                const change = older ? evaluatePriceChange(older.price, o.price) : null;
                return (
                  <li key={o.id} className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-text-muted">{dateText(o.observed_at)}</span>
                    <span className="numeric font-semibold text-ink-950">
                      {o.price != null ? formatTry(o.price) : "—"}
                      {change?.dropped ? <span className="ml-1.5 text-xs text-mint-600">↓ %{change.dropPct}</span> : change?.raised ? <span className="ml-1.5 text-xs text-text-muted">↑</span> : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
