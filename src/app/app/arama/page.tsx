import Link from "next/link";
import {
  Activity,
  Clock3,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Radio,
  UserCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { CallConsole } from "./call-console";
import { CallAiSummary } from "./call-ai-summary";
import { formatTurkishPhone, toTelHref } from "@/lib/phone";
import { isAiConfigured } from "@/lib/ai-advisor";

type CallRow = {
  id: string;
  direction: string;
  phone: string;
  duration_sec: number | null;
  disposition: string | null;
  notes: string | null;
  started_at: string;
  customer: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
};

function customerName(value: CallRow["customer"]) {
  if (!value) return "Bilinmeyen arayan";
  return Array.isArray(value) ? (value[0]?.full_name ?? "Bilinmeyen arayan") : value.full_name;
}

function customerId(value: CallRow["customer"]) {
  if (!value) return null;
  return Array.isArray(value) ? (value[0]?.id ?? null) : value.id;
}

function duration(value: number | null) {
  if (!value) return "—";
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

const CALL_SELECT = "id, direction, phone, duration_sec, disposition, notes, started_at, customer:customers(id, full_name)";

const YON_LABELS: Record<string, string> = { inbound: "Gelen", outbound: "Giden", missed: "Cevapsız" };

const PAGE_SIZE = 50;

/** YYYY-MM-DD biçimindeyse döndür, aksi halde boş — sorguya ham girdi gitmesin. */
function safeDate(value: string | undefined) {
  const v = (value ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
}

export default async function PhoneOsPage({
  searchParams,
}: {
  searchParams?: Promise<{ yon?: string; danisman?: string; sonuc?: string; from?: string; to?: string; sayfa?: string; customer?: string }>;
}) {
  await requireModulePage("calls");
  const params = (await searchParams) ?? {};
  // ?customer= — müşteri detayındaki "Görüşme kaydet" kısayolu: konsolda
  // ilgili müşteri seçili gelir (liste filtrelenmez, yalnızca ön seçim).
  const preCustomerId = (params.customer ?? "").trim() || undefined;
  const yon = Object.keys(YON_LABELS).includes(params.yon ?? "") ? params.yon : undefined;
  const danisman = (params.danisman ?? "").trim() || undefined;
  const sonuc = params.sonuc === "randevu" ? "randevu" : undefined;
  const fromF = safeDate(params.from);
  const toF = safeDate(params.to);
  const pageParam = Math.max(1, Number.parseInt(params.sayfa ?? "1", 10) || 1);
  const offset = (pageParam - 1) * PAGE_SIZE;
  const filtersActive = Boolean(yon || danisman || sonuc || fromF || toF);

  const supabase = await createClient();

  // AI özet butonu yalnızca OpenAI anahtarı varsa render edilir (server kontrolü)
  const aiEnabled = await isAiConfigured();

  // Liste ayrı sorgu — KPI ve hacim grafiği filtre/sayfalamadan etkilenmesin.
  // ?yon= & ?sonuc= & ?from= & ?to= sunucu tarafında, ?sayfa= `.range()` ile.
  let listQuery = supabase
    .from("calls")
    .select(CALL_SELECT, { count: "exact" })
    .order("started_at", { ascending: false });
  if (yon) listQuery = listQuery.eq("direction", yon);
  if (danisman) listQuery = listQuery.eq("handled_by", danisman);
  if (sonuc) listQuery = listQuery.eq("disposition", "Randevu aldı");
  if (fromF) listQuery = listQuery.gte("started_at", fromF);
  if (toF) listQuery = listQuery.lte("started_at", `${toF}T23:59:59.999`);

  const [{ data: calls }, { data: filteredCalls, count: listTotal }, { data: customers }, { data: demands }, { data: danismanProfile }] = await Promise.all([
    supabase
      .from("calls")
      .select(CALL_SELECT)
      .order("started_at", { ascending: false })
      .limit(100),
    listQuery.range(offset, offset + PAGE_SIZE - 1),
    // Konsol Combobox'ı sunucu aramalı (searchCustomers); bu liste yalnızca
    // "son eklenenler" kısayolu — sınırsız çekim 200 ile kısıtlandı.
    supabase
      .from("customers")
      .select("id, full_name, phone, customer_types, notes")
      .is("deleted_at", null)
      .order("full_name")
      .limit(200),
    supabase.from("customer_demands").select("customer_id, status").in("status", ["new", "active", "matched"]),
    danisman
      ? supabase.from("profiles").select("full_name").eq("id", danisman).maybeSingle()
      : Promise.resolve({ data: null as { full_name: string | null } | null }),
  ]);

  const rows = (calls ?? []) as CallRow[];
  const listRows = (filteredCalls ?? []) as CallRow[];
  const total = listTotal ?? listRows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageParam, totalPages);
  let customerList = customers ?? [];
  // Ön seçilen müşteri "son eklenenler" listesinde (limit 200) yoksa ayrıca
  // çekilip başa eklenir — kısayol her müşteri için çalışsın.
  if (preCustomerId && !customerList.some((c) => c.id === preCustomerId)) {
    const { data: preCustomer } = await supabase
      .from("customers")
      .select("id, full_name, phone, customer_types, notes")
      .eq("id", preCustomerId)
      .is("deleted_at", null)
      .maybeSingle();
    if (preCustomer) customerList = [preCustomer, ...customerList];
  }
  const demandCounts: Record<string, number> = {};
  const matchCounts: Record<string, number> = {};
  for (const d of demands ?? []) {
    if (!d.customer_id) continue;
    if (d.status === "matched") matchCounts[d.customer_id] = (matchCounts[d.customer_id] ?? 0) + 1;
    else demandCounts[d.customer_id] = (demandCounts[d.customer_id] ?? 0) + 1;
  }
  const inbound = rows.filter((call) => call.direction === "inbound").length;
  const missed = rows.filter((call) => call.direction === "missed").length;
  const appointments = rows.filter((call) => call.disposition === "Randevu aldı").length;

  // KPI bağlantıları — aynı filtre aktifken tıklama filtreyi kaldırır (toggle),
  // gelen ?danisman= ve tarih aralığı korunur; sayfa 1'e döner.
  const kpiHref = (patch: { yon?: string; sonuc?: string }) => {
    const sp = new URLSearchParams();
    if (patch.yon && patch.yon !== yon) sp.set("yon", patch.yon);
    if (patch.sonuc && patch.sonuc !== sonuc) sp.set("sonuc", patch.sonuc);
    if (danisman) sp.set("danisman", danisman);
    if (fromF) sp.set("from", fromF);
    if (toF) sp.set("to", toF);
    const qs = sp.toString();
    return qs ? `/app/arama?${qs}` : "/app/arama";
  };

  /** Tüm filtreleri koruyarak sayfa linki üretir. */
  const pageHref = (sayfa: number) => {
    const sp = new URLSearchParams();
    if (yon) sp.set("yon", yon);
    if (sonuc) sp.set("sonuc", sonuc);
    if (danisman) sp.set("danisman", danisman);
    if (fromF) sp.set("from", fromF);
    if (toF) sp.set("to", toF);
    if (sayfa > 1) sp.set("sayfa", String(sayfa));
    const qs = sp.toString();
    return qs ? `/app/arama?${qs}` : "/app/arama";
  };

  const today = new Date();
  const volume = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(today);
    d.setDate(today.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    const count = rows.filter((r) => r.started_at?.slice(0, 10) === key).length;
    return { label: d.toLocaleDateString("tr-TR", { weekday: "short" }), count };
  });
  const maxVol = Math.max(1, ...volume.map((v) => v.count));
  const answered = rows.filter((call) => call.direction !== "missed").length;
  const answerRate = rows.length ? answered / rows.length : 0;
  const avgDur = rows.length ? Math.round(rows.reduce((s, r) => s + (r.duration_sec ?? 0), 0) / rows.length) : 0;

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-mint-500/25 blur-[80px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400"><Radio className="h-4 w-4" /> Görüşme kayıt merkezi</span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Akıllı Arama</h1>
            <p className="mt-1 text-sm text-white/60">Müşteri eşleştirme, sonuç kodu ve görüşme geçmişi tek akışta kayıt altında.</p>
            <div className="mt-6 grid grid-cols-3 gap-3">
              {[
                { label: "Gelen çağrı", value: inbound, icon: PhoneIncoming, tone: "text-cyan-400", href: kpiHref({ yon: "inbound" }), active: yon === "inbound" },
                { label: "Cevapsız", value: missed, icon: PhoneMissed, tone: "text-danger-500", href: kpiHref({ yon: "missed" }), active: yon === "missed" },
                { label: "Randevu", value: appointments, icon: UserCheck, tone: "text-mint-400", href: kpiHref({ sonuc: "randevu" }), active: sonuc === "randevu" },
              ].map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`focus-ring press lift block rounded-[14px] border p-3 backdrop-blur transition ${
                    item.active ? "border-mint-400/50 bg-white/12" : "border-white/10 bg-white/5 hover:border-white/30"
                  }`}
                >
                  <item.icon className={`h-4 w-4 ${item.tone}`} />
                  <p className="mt-2 font-display text-xl font-extrabold text-white">{item.value}</p>
                  <p className="text-[11px] text-white/45 sm:text-xs">{item.label}</p>
                </Link>
              ))}
            </div>
          </div>

          {/* live call volume */}
          <div className="rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-white/75"><Activity className="h-3.5 w-3.5 text-cyan-400" /> Arama hacmi · son 7 gün</p>
              <span className="rounded-full bg-mint-500/15 px-2 py-0.5 text-[11px] font-bold text-mint-400">cevap %{Math.round(answerRate * 100)}</span>
            </div>
            <div className="mt-4 flex h-24 items-end gap-2">
              {volume.map((v, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="flex h-full w-full items-end justify-center">
                    <div
                      className="bar-live w-full max-w-[16px] rounded-t-[4px] bg-[image:var(--grad-brand)] shadow-[0_0_10px_-2px_rgba(20,99,255,0.6)]"
                      style={{ height: `${Math.max((v.count / maxVol) * 100, 6)}%`, animationDelay: `${i * 0.08}s` }}
                    />
                  </div>
                  <span className="text-[10px] text-white/40">{v.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 border-t border-white/10 pt-3">
              <span className="flex h-5 items-center gap-[3px]">
                {Array.from({ length: 16 }).map((_, i) => (
                  <span key={i} className="wave-bar h-full w-[2px] rounded-full bg-mint-400/70" style={{ animationDelay: `${i * 0.08}s` }} />
                ))}
              </span>
              <span className="text-[11px] text-white/55">Ort. görüşme {duration(avgDur)} · {rows.length} kayıt</span>
            </div>
          </div>
        </div>
      </section>

      <CallConsole customers={customerList} demandCounts={demandCounts} matchCounts={matchCounts} initialCustomerId={preCustomerId} />

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
          <div><p className="flex items-center gap-2 text-xs font-semibold text-brand-600"><Clock3 className="h-4 w-4" /> Gerçek kayıtlar</p><h2 className="mt-1 font-display font-bold text-ink-950">Çağrı geçmişi</h2></div>
          <div className="flex flex-wrap items-center gap-2">
            {filtersActive ? (
              <>
                {yon ? <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">{YON_LABELS[yon]}</span> : null}
                {sonuc ? <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">Randevu aldı</span> : null}
                {danisman ? (
                  <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">
                    {danismanProfile?.full_name ?? "Danışman"}
                  </span>
                ) : null}
                {fromF || toF ? (
                  <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">
                    {fromF || "…"} — {toF || "…"}
                  </span>
                ) : null}
                <Link href="/app/arama" className="text-[11px] font-semibold text-text-muted underline-offset-2 hover:text-brand-600 hover:underline">
                  Temizle
                </Link>
              </>
            ) : null}
            <span className="rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600">
              {total} çağrı{totalPages > 1 ? ` · sayfa ${page}/${totalPages}` : ""}
            </span>
          </div>
        </div>
        {/* ?from=&to= — tarih aralığı GET formu; yön/sonuç/danışman gizli alanlarla korunur */}
        <form method="get" action="/app/arama" className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/50 px-5 py-3">
          {yon ? <input type="hidden" name="yon" value={yon} /> : null}
          {sonuc ? <input type="hidden" name="sonuc" value={sonuc} /> : null}
          {danisman ? <input type="hidden" name="danisman" value={danisman} /> : null}
          <span className="text-xs font-medium text-text-muted">Tarih:</span>
          <input
            name="from"
            type="date"
            defaultValue={fromF}
            aria-label="Başlangıç tarihi"
            className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
          />
          <span className="text-text-faint">—</span>
          <input
            name="to"
            type="date"
            defaultValue={toF}
            aria-label="Bitiş tarihi"
            className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
          />
          <button type="submit" className="focus-ring press rounded-[9px] bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-700">
            Uygula
          </button>
        </form>
        {listRows.length === 0 ? (
          <div className="grid place-items-center px-6 py-14 text-center"><span className="grid h-14 w-14 place-items-center rounded-[16px] bg-brand-600/10 text-brand-600"><PhoneIncoming className="h-7 w-7" /></span><h3 className="mt-4 font-display text-lg font-bold text-ink-950">{filtersActive ? "Filtreye uyan çağrı yok" : total > 0 ? "Bu sayfada kayıt yok" : "Henüz çağrı kaydı yok"}</h3><p className="mt-1 text-sm text-text-muted">{filtersActive ? "Filtreyi temizleyip tüm kayıtları görebilirsiniz." : total > 0 ? <>Sayfa numarası aralık dışında. <Link href={pageHref(1)} className="font-semibold text-brand-600 hover:underline">İlk sayfaya dön</Link></> : "İlk görüşmeyi kaydettiğinizde çağrı geçmişi burada oluşacak."}</p></div>
        ) : (
          <div className="divide-y divide-line">
            {listRows.map((call) => {
              const DirectionIcon = call.direction === "inbound" ? PhoneIncoming : call.direction === "outbound" ? PhoneOutgoing : PhoneMissed;
              const custId = customerId(call.customer);
              const tel = toTelHref(call.phone);
              return (
                <article key={call.id} className="group relative grid gap-3 px-5 py-4 transition hover:bg-brand-600/[0.02] md:grid-cols-[1.2fr_.8fr_.8fr_.7fr] md:items-center">
                  {custId ? (
                    <Link href={`/app/musteriler/${custId}`} className="absolute inset-0" aria-label={`${customerName(call.customer)} müşterisini aç`} />
                  ) : null}
                  <div className="flex items-center gap-3">
                    <span className={`grid h-10 w-10 place-items-center rounded-[11px] ${call.direction === "missed" ? "bg-danger-500/10 text-danger-500" : "bg-brand-600/10 text-brand-600"}`}><DirectionIcon className="h-4 w-4" /></span>
                    <div>
                      <p className="text-sm font-semibold text-ink-950">{customerName(call.customer)}</p>
                      {/* Ortu linkin ustunde kalmasi icin relative z-10 */}
                      {tel ? (
                        <a href={tel} className="focus-ring relative z-10 text-xs tabular-nums text-text-muted transition hover:text-brand-600 hover:underline">
                          {formatTurkishPhone(call.phone)}
                        </a>
                      ) : (
                        <p className="text-xs tabular-nums text-text-muted">{formatTurkishPhone(call.phone)}</p>
                      )}
                      {!custId ? (
                        <Link
                          href="/app/musteriler"
                          className="relative z-10 mt-0.5 block text-[11px] font-semibold text-brand-600 underline-offset-2 hover:underline"
                        >
                          Müşteri oluştur
                        </Link>
                      ) : null}
                    </div>
                  </div>
                  <div><p className="text-[11px] text-text-faint">Sonuç</p><p className="text-xs font-semibold text-ink-950">{call.disposition ?? "Cevapsız"}</p></div>
                  <div><p className="text-[11px] text-text-faint">Süre</p><p className="text-xs font-semibold tabular-nums text-ink-950">{duration(call.duration_sec)}</p></div>
                  <div className="text-xs text-text-muted">{new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(call.started_at))}</div>
                  {/* AI özet — yalnız notu olan çağrılarda ve anahtar server'da doğrulanınca */}
                  {aiEnabled && call.notes?.trim() ? <CallAiSummary callId={call.id} /> : null}
                </article>
              );
            })}
          </div>
        )}
        {totalPages > 1 ? (
          <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
            {page > 1 ? (
              <Link href={pageHref(page - 1)} className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                ← Önceki
              </Link>
            ) : (
              <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">← Önceki</span>
            )}
            <span className="text-xs tabular-nums text-text-muted">Sayfa {page} / {totalPages}</span>
            {page < totalPages ? (
              <Link href={pageHref(page + 1)} className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600">
                Sonraki →
              </Link>
            ) : (
              <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">Sonraki →</span>
            )}
          </nav>
        ) : null}
      </section>
    </div>
  );
}
