import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleHelp,
  Clock3,
  KeyRound,
  MessageSquare,
  Percent,
  Receipt,
  ShieldCheck,
  Timer,
  TrendingDown,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now as nowMs } from "@/lib/clock";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import type { ComboboxOption } from "@/components/ui/combobox";
import {
  APPROVAL_KINDS,
  APPROVAL_STATUS_LABEL,
  averageDecisionHours,
  formatDelta,
  isApprovalKind,
  isApprovalStatus,
  isManagerRole,
  isOverdue,
  kindMeta,
  slaHours,
  waitingLabel,
  type ApprovalStatus,
} from "@/lib/approvals";
import { NewApprovalDialog } from "./new-approval-dialog";
import { ApprovalCommentForm, CancelApprovalButton, DecisionDialog } from "./approval-actions";

const PAGE_SIZE = 20;

/** `kindMeta.icon` string → bileşen. Sözlük saf kalsın diye eşleme burada. */
const ICONS: Record<string, LucideIcon> = {
  Percent,
  Receipt,
  TrendingDown,
  KeyRound,
  CircleHelp,
};

const TONE_CHIP: Record<string, string> = {
  brand: "bg-brand-600/10 text-brand-700",
  amber: "bg-amber-400/15 text-amber-700",
  mint: "bg-mint-500/12 text-mint-700",
  danger: "bg-danger-500/10 text-danger-600",
  neutral: "bg-ink-950/[0.06] text-text-muted",
};

const STATUS_CHIP: Record<ApprovalStatus, string> = {
  bekliyor: "bg-amber-400/15 text-amber-700",
  onaylandi: "bg-mint-500/12 text-mint-700",
  reddedildi: "bg-danger-500/10 text-danger-600",
  iptal: "bg-ink-950/[0.06] text-text-muted",
};

/** İlgili kaydın panel içi hedefi. Gider listesi tekil sayfa taşımıyor → listeye. */
function entityHref(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  if (type === "deal") return `/app/anlasmalar/${id}`;
  if (type === "property") return `/app/portfoyler/${id}`;
  if (type === "expense") return "/app/giderler";
  return null;
}

const ENTITY_LABEL: Record<string, string> = {
  deal: "Anlaşma",
  expense: "Gider",
  property: "Portföy",
};

type Row = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  current_value: number | null;
  requested_value: number | null;
  entity_type: string | null;
  entity_id: string | null;
  status: ApprovalStatus;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
};

function dtFmt(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

export default async function OnaylarPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; tur?: string; kim?: string; sayfa?: string }>;
}) {
  const { userId, role } = await requireModulePage("commissions");
  const params = (await searchParams) ?? {};

  // Varsayılan sekme "bekliyor": bu ekranın işi karar bekleyenleri öne almak.
  const durum: ApprovalStatus = isApprovalStatus(params.durum ?? "") ? (params.durum as ApprovalStatus) : "bekliyor";
  const tur = isApprovalKind(params.tur ?? "") ? params.tur! : "";
  const kim = params.kim === "benim" || params.kim === "bana" ? params.kim : "";
  const sayfa = Math.max(1, Number.parseInt(params.sayfa ?? "1", 10) || 1);

  const manager = isManagerRole(role);
  const supabase = await createClient();
  const t = nowMs();

  /** Filtreleri koruyan link üretici (sayfa değişince 1'e döner). */
  const href = (next: { durum?: string; tur?: string | null; kim?: string | null; sayfa?: number }) => {
    const sp = new URLSearchParams();
    const d = next.durum ?? durum;
    if (d && d !== "bekliyor") sp.set("durum", d);
    const k = next.tur === undefined ? tur : (next.tur ?? "");
    if (k) sp.set("tur", k);
    const w = next.kim === undefined ? kim : (next.kim ?? "");
    if (w) sp.set("kim", w);
    if (next.sayfa && next.sayfa > 1) sp.set("sayfa", String(next.sayfa));
    const qs = sp.toString();
    return qs ? `/app/onaylar?${qs}` : "/app/onaylar";
  };

  let listQuery = supabase
    .from("approval_requests")
    .select(
      "id, kind, title, description, current_value, requested_value, entity_type, entity_id, status, requested_by, decided_by, decided_at, decision_note, created_at",
      { count: "exact" },
    )
    .eq("status", durum)
    .order("created_at", { ascending: false })
    .range((sayfa - 1) * PAGE_SIZE, sayfa * PAGE_SIZE - 1);
  if (tur) listQuery = listQuery.eq("kind", tur);
  // ?kim=benim → kendi taleplerim; ?kim=bana → başkalarının, yani karar bekleyenim.
  if (kim === "benim") listQuery = listQuery.eq("requested_by", userId);
  else if (kim === "bana") listQuery = listQuery.neq("requested_by", userId);

  // Ayın ilk günü — "bu ay onaylanan/reddedilen" KPI'ları için.
  const d = new Date(t);
  const ayBasi = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();

  const [
    { data: rows, count: total },
    { data: pendingRows },
    { count: onayliAy },
    { count: redAy },
    { data: kararRows },
    { data: turRows },
  ] = await Promise.all([
    listQuery,
    // Gecikme vurgusu için bekleyenlerin yaş+türü (sayfa dışı da dahil).
    supabase.from("approval_requests").select("id, kind, created_at").eq("status", "bekliyor").limit(500),
    supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("status", "onaylandi").gte("decided_at", ayBasi),
    supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("status", "reddedildi").gte("decided_at", ayBasi),
    supabase.from("approval_requests").select("created_at, decided_at").not("decided_at", "is", null).gte("decided_at", ayBasi).limit(500),
    // Tür çipi sayaçları — mevcut durum sekmesi içinde.
    supabase.from("approval_requests").select("kind").eq("status", durum).limit(1000),
  ]);

  const list = (rows ?? []) as Row[];
  const toplam = total ?? 0;
  const totalPages = Math.max(1, Math.ceil(toplam / PAGE_SIZE));

  const bekleyen = pendingRows ?? [];
  const geciken = bekleyen.filter((r) => isOverdue(r.created_at, r.kind, t)).length;
  const ortSaat = averageDecisionHours((kararRows ?? []) as { created_at: string; decided_at: string | null }[]);

  const turSayac = new Map<string, number>();
  for (const r of turRows ?? []) turSayac.set(r.kind, (turSayac.get(r.kind) ?? 0) + 1);

  // Kişi adları — talep eden / karar veren / yorum yazarı tek sorguda.
  const requestIds = list.map((r) => r.id);
  const { data: comments } = requestIds.length
    ? await supabase
        .from("approval_comments")
        .select("id, request_id, author_id, body, created_at")
        .in("request_id", requestIds)
        .order("created_at", { ascending: true })
        .limit(500)
    : { data: [] as { id: string; request_id: string; author_id: string | null; body: string; created_at: string }[] };

  const personIds = [
    ...new Set(
      [
        ...list.map((r) => r.requested_by),
        ...list.map((r) => r.decided_by),
        ...(comments ?? []).map((c) => c.author_id),
      ].filter(Boolean) as string[],
    ),
  ];
  const names = new Map<string, string>();
  if (personIds.length) {
    const { data: profiles } = await supabase.from("profiles").select("id, full_name").in("id", personIds);
    for (const p of profiles ?? []) names.set(p.id, p.full_name);
  }
  const adOf = (id: string | null) => (id ? (names.get(id) ?? "—") : "—");

  const commentsByRequest = new Map<string, typeof comments>();
  for (const c of comments ?? []) {
    const arr = commentsByRequest.get(c.request_id) ?? [];
    arr.push(c);
    commentsByRequest.set(c.request_id, arr as typeof comments);
  }

  // Yeni talep dialogu için "ilgili kayıt" havuzu (anlaşma + gider, aramalı).
  const [{ data: deals }, { data: expenses }] = await Promise.all([
    supabase
      .from("deals")
      .select("id, deal_value, stage, deal_type, property:properties(property_code, title)")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("expenses").select("id, title, amount, expense_date").order("expense_date", { ascending: false }).limit(50),
  ]);

  const entityOptions: ComboboxOption[] = [
    ...(deals ?? []).map((dl) => {
      const prop = Array.isArray(dl.property) ? dl.property[0] : dl.property;
      return {
        value: `deal:${dl.id}`,
        label: `Anlaşma · ${prop?.property_code ?? dl.id.slice(0, 8)}${prop?.title ? ` — ${prop.title}` : ""}`,
        hint: `${dl.deal_type === "rent" ? "Kiralama" : "Satış"} · ${
          dl.deal_value ? new Intl.NumberFormat("tr-TR").format(Number(dl.deal_value)) + " ₺" : "tutar yok"
        }`,
      };
    }),
    ...(expenses ?? []).map((ex) => ({
      value: `expense:${ex.id}`,
      label: `Gider · ${ex.title}`,
      hint: `${new Intl.NumberFormat("tr-TR").format(Number(ex.amount))} ₺ · ${ex.expense_date}`,
    })),
  ];

  const statuses: ApprovalStatus[] = ["bekliyor", "onaylandi", "reddedildi", "iptal"];

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-mint-500/20 blur-[80px]" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
              <ShieldCheck className="h-4 w-4" /> Onay merkezi
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Onaylar</h1>
            <p className="mt-1 max-w-xl text-sm text-white/60">
              Müdür onayı gereken işler — komisyon indirimi, olağandışı gider, fiyat değişikliği.
              Talep, karar ve gerekçe kayıt altında.
            </p>
          </div>
          <NewApprovalDialog entityOptions={entityOptions} />
        </div>
      </section>

      {/* KPI şeridi — her kart filtrelenmiş listeye gider */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={geciken > 0 ? `Bekleyen · ${geciken} gecikmiş` : "Bekleyen onay"}
          value={bekleyen.length}
          icon={Clock3}
          tone={geciken > 0 ? "warning" : "neutral"}
          trend={geciken > 0 ? "down" : undefined}
          trendLabel={geciken > 0 ? `⏱ ${geciken} gecikti` : undefined}
          href="/app/onaylar?durum=bekliyor"
        />
        <StatCard label="Bu ay onaylanan" value={onayliAy ?? 0} icon={CheckCircle2} tone="success" href="/app/onaylar?durum=onaylandi" />
        <StatCard label="Bu ay reddedilen" value={redAy ?? 0} icon={XCircle} tone="danger" href="/app/onaylar?durum=reddedildi" />
        <StatCard
          label="Ortalama karar süresi"
          value={ortSaat === null ? "—" : `${ortSaat.toLocaleString("tr-TR")} sa`}
          icon={Timer}
          tone={ortSaat !== null && ortSaat > 48 ? "warning" : "neutral"}
          href="/app/onaylar?durum=onaylandi"
        />
      </div>

      {/* Sekmeler + filtreler */}
      <div className="space-y-3 rounded-[18px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center gap-2">
          {statuses.map((s) => {
            const aktif = durum === s;
            return (
              <Link
                key={s}
                href={href({ durum: s, sayfa: 1 })}
                aria-current={aktif ? "page" : undefined}
                className={`focus-ring press rounded-full border px-3.5 py-1.5 text-xs font-semibold transition ${
                  aktif
                    ? "border-brand-400/60 bg-brand-600/10 text-brand-700"
                    : "border-line bg-canvas text-text-muted hover:border-brand-300 hover:text-brand-600"
                }`}
              >
                {APPROVAL_STATUS_LABEL[s]}
              </Link>
            );
          })}
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {[
              { v: "", label: "Tümü" },
              { v: "bana", label: "Bana gelenler" },
              { v: "benim", label: "Benim taleplerim" },
            ].map((o) => {
              const aktif = kim === o.v;
              return (
                <Link
                  key={o.label}
                  href={href({ kim: o.v || null, sayfa: 1 })}
                  aria-current={aktif ? "page" : undefined}
                  className={`focus-ring press rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                    aktif ? "bg-ink-950 text-white" : "bg-canvas text-text-muted hover:text-brand-600"
                  }`}
                >
                  {o.label}
                </Link>
              );
            })}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-faint">Tür:</span>
          <Link
            href={href({ tur: null, sayfa: 1 })}
            aria-current={tur === "" ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
              tur === "" ? "border-brand-400/60 bg-brand-600/10 text-brand-700" : "border-line text-text-muted hover:border-brand-300 hover:text-brand-600"
            }`}
          >
            Tümü
          </Link>
          {APPROVAL_KINDS.map((k) => {
            const meta = kindMeta(k);
            const aktif = tur === k;
            const adet = turSayac.get(k) ?? 0;
            return (
              <Link
                key={k}
                href={href({ tur: aktif ? null : k, sayfa: 1 })}
                aria-current={aktif ? "page" : undefined}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                  aktif ? "border-brand-400/60 bg-brand-600/10 text-brand-700" : "border-line text-text-muted hover:border-brand-300 hover:text-brand-600"
                }`}
              >
                {meta.label}
                {adet > 0 ? <span className="numeric ml-1 text-text-faint">{adet}</span> : null}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Liste */}
      {list.length === 0 ? (
        durum === "bekliyor" && !tur && !kim ? (
          <EmptyState
            icon={ShieldCheck}
            title="Bekleyen onay yok — her şey yolunda"
            description="Komisyon indirimi, olağandışı gider ya da fiyat değişikliği talebi açıldığında burada belirir ve yöneticilere bildirim gider."
            tone="mint"
          />
        ) : (
          <EmptyState
            icon={ShieldCheck}
            title={`${APPROVAL_STATUS_LABEL[durum]} talep yok`}
            description="Filtreleri değiştirerek diğer talepleri görebilirsiniz."
            tone="brand"
            action={{ href: "/app/onaylar", label: "Filtreleri temizle" }}
          />
        )
      ) : (
        <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <div className="divide-y divide-line">
            {list.map((r) => {
              const meta = kindMeta(r.kind);
              const Icon = ICONS[meta.icon] ?? CircleHelp;
              const delta = formatDelta(r.current_value, r.requested_value, r.kind);
              const gecikti = r.status === "bekliyor" && isOverdue(r.created_at, r.kind, t);
              const link = entityHref(r.entity_type, r.entity_id);
              const benim = r.requested_by === userId;
              const rowComments = commentsByRequest.get(r.id) ?? [];
              const deltaCls =
                delta.direction === "azalis"
                  ? "bg-danger-500/8 text-danger-600"
                  : delta.direction === "artis"
                    ? "bg-mint-500/12 text-mint-700"
                    : "bg-ink-950/[0.05] text-text-muted";

              return (
                <details key={r.id} className="group px-5 py-4 transition open:bg-brand-600/[0.02]">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[11px] ${TONE_CHIP[meta.tone]}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${TONE_CHIP[meta.tone]}`}>{meta.label}</span>
                        <span className="truncate text-sm font-semibold text-ink-950">{r.title}</span>
                        {r.status !== "bekliyor" ? (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CHIP[r.status]}`}>
                            {APPROVAL_STATUS_LABEL[r.status]}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
                        <span>{adOf(r.requested_by)}{benim ? " (siz)" : ""}</span>
                        {link ? (
                          <Link href={link} className="focus-ring inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline">
                            {ENTITY_LABEL[r.entity_type ?? ""] ?? "İlgili kayıt"}
                            <ArrowUpRight className="h-3 w-3" />
                          </Link>
                        ) : null}
                        {r.status === "bekliyor" ? (
                          <span className={gecikti ? "font-semibold text-amber-700" : ""}>
                            {gecikti ? "⏱ " : ""}
                            {waitingLabel(r.created_at, t)}
                            {gecikti ? ` · hedef ${slaHours(r.kind)} sa` : ""}
                          </span>
                        ) : (
                          <span>{r.decided_at ? `${dtFmt(r.decided_at)} · ${adOf(r.decided_by)}` : dtFmt(r.created_at)}</span>
                        )}
                        {rowComments.length > 0 ? (
                          <span className="inline-flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" /> {rowComments.length}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className={`numeric shrink-0 rounded-[9px] px-2.5 py-1 text-xs font-bold ${deltaCls}`}>{delta.text}</span>
                    <span className="flex shrink-0 flex-wrap items-center gap-2">
                      {r.status === "bekliyor" && manager && !benim ? (
                        <>
                          <DecisionDialog requestId={r.id} decision="onaylandi" requestTitle={r.title} />
                          <DecisionDialog requestId={r.id} decision="reddedildi" requestTitle={r.title} />
                        </>
                      ) : null}
                      {r.status === "bekliyor" && benim ? (
                        <CancelApprovalButton requestId={r.id} requestTitle={r.title} />
                      ) : null}
                    </span>
                  </summary>

                  {/* Detay — açıklama + karar geçmişi + yorum akışı */}
                  <div className="mt-3 space-y-3 border-t border-line pt-3 pl-12">
                    {r.description ? (
                      <p className="whitespace-pre-line text-sm text-text-muted">{r.description}</p>
                    ) : (
                      <p className="text-sm text-text-faint">Açıklama girilmemiş.</p>
                    )}

                    <div className="rounded-[12px] bg-canvas/60 p-3 text-[11px] text-text-muted">
                      <p>
                        <strong className="text-ink-950">Talep:</strong> {dtFmt(r.created_at)} · {adOf(r.requested_by)}
                        {r.status === "bekliyor" ? ` · hedef karar süresi ${slaHours(r.kind)} saat` : ""}
                      </p>
                      {r.decided_at ? (
                        <p className="mt-1">
                          <strong className="text-ink-950">
                            {r.status === "onaylandi" ? "Onay" : r.status === "reddedildi" ? "Ret" : "Karar"}:
                          </strong>{" "}
                          {dtFmt(r.decided_at)} · {adOf(r.decided_by)}
                          {r.decision_note ? ` — “${r.decision_note}”` : ""}
                        </p>
                      ) : null}
                      {r.status === "iptal" ? <p className="mt-1">Talep sahibi tarafından geri çekildi.</p> : null}
                      {r.status === "bekliyor" && benim && manager ? (
                        <p className="mt-1 text-amber-700">Kendi talebinizi onaylayamazsınız — başka bir yönetici karar vermeli.</p>
                      ) : null}
                    </div>

                    {rowComments.length > 0 ? (
                      <ul className="space-y-2">
                        {rowComments.map((c) => (
                          <li key={c.id} className="rounded-[12px] border border-line bg-canvas/40 px-3 py-2">
                            <p className="text-[11px] font-semibold text-text-muted">
                              {adOf(c.author_id)} · {dtFmt(c.created_at)}
                            </p>
                            <p className="mt-0.5 whitespace-pre-line text-sm text-ink-950">{c.body}</p>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11px] text-text-faint">Henüz not yok — soru sormak için aşağıya yazın.</p>
                    )}

                    <ApprovalCommentForm requestId={r.id} />
                  </div>
                </details>
              );
            })}
          </div>

          {totalPages > 1 ? (
            <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
              {sayfa > 1 ? (
                <Link href={href({ sayfa: sayfa - 1 })} className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                  ← Önceki
                </Link>
              ) : (
                <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">← Önceki</span>
              )}
              <span className="text-xs tabular-nums text-text-muted">
                Sayfa {sayfa} / {totalPages} · toplam {toplam.toLocaleString("tr-TR")} talep
              </span>
              {sayfa < totalPages ? (
                <Link href={href({ sayfa: sayfa + 1 })} className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                  Sonraki →
                </Link>
              ) : (
                <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">Sonraki →</span>
              )}
            </nav>
          ) : null}
        </section>
      )}
    </div>
  );
}
