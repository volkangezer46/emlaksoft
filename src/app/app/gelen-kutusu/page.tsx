import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  PhoneMissed,
  Search,
  StickyNote,
  UserX,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { daysAgoIso } from "@/lib/clock";
import { COMM_CHANNELS, COMM_OUTCOMES } from "@/lib/comm-types";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";
import { EmptyState } from "@/components/app/empty-state";
import { listSavedViews } from "@/app/actions/saved-views";
import { SavedViews } from "@/components/app/saved-views";
import { SmsDialog } from "./sms-dialog";
import { RowQuickActions } from "./row-actions";

/**
 * Gelen Kutusu — birleşik iletişim akışı (v1: salt görünüm + navigasyon).
 *
 * İki kaynağı TEK kronolojik akışta birleştirir:
 *   - communications (sms / whatsapp / email / note / meeting / call özetleri)
 *   - calls          (detaylı çağrı kayıtları: yön + sonuç)
 *
 * Kampanya gönderimleri BİLİNÇLİ olarak yok: kampanyalar communications'a değil
 * campaign_recipients tablosuna yazar (actions/campaigns.ts) — yüzlerce aynı
 * mesaj akışı gürültüye boğardı; kendi ekranı /app/kampanyalar'da.
 *
 * Sayfalama iki tablo üzerinde "merge" ile yapılır: her kaynaktan ilk
 * (offset + PAGE_SIZE) kayıt çekilir, bellekte tarihe göre birleştirilip dilim
 * alınır. Sayfa derinleştikçe maliyet artar ama 50'lik sayfalarda pratikte
 * sorun değil; gerçek bir DB-union'ı view/migration gerektirirdi.
 */

const PAGE_SIZE = 50;

type UnifiedItem = {
  key: string;
  channel: string;          // comm_channel değeri veya "call"
  direction: string;        // inbound | outbound | internal | missed
  customerId: string | null;
  customerName: string | null;
  phone: string | null;     // müşterisiz çağrılarda ham numara
  summary: string;
  outcome: string | null;
  at: string;               // ISO — sıralama anahtarı
};

type EmbeddedCustomer = { id: string; full_name: string; phone: string | null };

function embedded(c: EmbeddedCustomer | EmbeddedCustomer[] | null): EmbeddedCustomer | null {
  if (!c) return null;
  return Array.isArray(c) ? (c[0] ?? null) : c;
}

const CHANNEL_META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  call:     { label: "Telefon",  icon: Phone,         cls: "bg-brand-600/10 text-brand-600" },
  whatsapp: { label: "WhatsApp", icon: MessageCircle, cls: "bg-mint-500/12 text-mint-600" },
  sms:      { label: "SMS",      icon: MessageSquare, cls: "bg-cyan-500/12 text-cyan-600" },
  email:    { label: "E-posta",  icon: Mail,          cls: "bg-violet-500/12 text-violet-600" },
  meeting:  { label: "Görüşme",  icon: Users,         cls: "bg-amber-400/15 text-amber-600" },
  note:     { label: "Not",      icon: StickyNote,    cls: "bg-ink-950/5 text-text-muted" },
};

const OUTCOME_LABELS = new Map<string, string>(COMM_OUTCOMES.map((o) => [o.value, o.label]));

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "Az önce";
  if (mins < 60) return `${mins} dk önce`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} sa önce`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Dün";
  if (days < 30) return `${days} gün önce`;
  if (days < 365) return `${Math.floor(days / 30)} ay önce`;
  return `${Math.floor(days / 365)} yıl önce`;
}

function truncate(text: string, max = 120): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

const PAGER_BTN =
  "focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas";
const PAGER_BTN_DISABLED =
  "inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 opacity-40";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    kanal?: string;
    from?: string;
    to?: string;
    durum?: string;
    sayfa?: string;
  }>;
}) {
  await requireModulePage("calls");
  const supabase = await createClient();
  const savedViews = await listSavedViews("/app/gelen-kutusu");
  const sp = await searchParams;

  const q = sp.q ?? "";
  const kanalF = COMM_CHANNELS.some((c) => c.value === sp.kanal) ? String(sp.kanal) : "";
  const fromF = sp.from ?? "";
  const toF = sp.to ?? "";
  const unmatchedOnly = sp.durum === "eslesmemis";
  const page = Math.max(1, Number.parseInt(sp.sayfa ?? "", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  // Merge sayfalaması: her kaynaktan bu kadar kayıt çekilir (yorum yukarıda)
  const fetchCeil = offset + PAGE_SIZE;

  const term = q.trim().replace(/[%_,()]/g, " ").trim();
  const includeCalls = kanalF === "" || kanalF === "call";

  // ---- communications sorgusu ---------------------------------------------
  // Müşteri araması gömülü tabloda ilike ister → !inner join (arama yokken
  // left join: müşterisiz kayıtlar da akışta görünmeli).
  const commSelect = term
    ? "id, channel, direction, subject, body, outcome, created_at, customer:customers!inner(id, full_name, phone)"
    : "id, channel, direction, subject, body, outcome, created_at, customer:customers(id, full_name, phone)";
  let commQuery = supabase
    .from("communications")
    .select(commSelect, { count: "exact" })
    .order("created_at", { ascending: false })
    .range(0, fetchCeil - 1);
  if (kanalF) commQuery = commQuery.eq("channel", kanalF);
  if (fromF) commQuery = commQuery.gte("created_at", fromF);
  if (toF) commQuery = commQuery.lte("created_at", `${toF}T23:59:59`);
  if (unmatchedOnly) commQuery = commQuery.is("customer_id", null);
  if (term) commQuery = commQuery.ilike("customer.full_name", `%${term}%`);

  // ---- calls sorgusu (yalnız "Tümü" veya "Telefon" filtresinde) -----------
  const callSelect = term
    ? "id, direction, phone, disposition, notes, duration_sec, started_at, customer:customers!inner(id, full_name, phone)"
    : "id, direction, phone, disposition, notes, duration_sec, started_at, customer:customers(id, full_name, phone)";
  let callQuery = supabase
    .from("calls")
    .select(callSelect, { count: "exact" })
    .order("started_at", { ascending: false })
    .range(0, fetchCeil - 1);
  if (fromF) callQuery = callQuery.gte("started_at", fromF);
  if (toF) callQuery = callQuery.lte("started_at", `${toF}T23:59:59`);
  if (unmatchedOnly) callQuery = callQuery.is("customer_id", null);
  if (term) callQuery = callQuery.ilike("customer.full_name", `%${term}%`);

  // ---- KPI head-count sorguları -------------------------------------------
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();
  const weekAgoIso = daysAgoIso(7);

  const [
    { data: commRows, count: commCount },
    callsRes,
    { count: commInToday },
    { count: callInToday },
    { count: commWeek },
    { count: callWeek },
    { count: commUnmatched },
    { count: callUnmatched },
  ] = await Promise.all([
    commQuery,
    includeCalls
      ? callQuery
      : Promise.resolve({ data: null, count: 0 } as { data: null; count: number }),
    supabase.from("communications").select("id", { count: "exact", head: true }).eq("direction", "inbound").gte("created_at", todayIso),
    supabase.from("calls").select("id", { count: "exact", head: true }).eq("direction", "inbound").gte("started_at", todayIso),
    supabase.from("communications").select("id", { count: "exact", head: true }).gte("created_at", weekAgoIso),
    supabase.from("calls").select("id", { count: "exact", head: true }).gte("started_at", weekAgoIso),
    supabase.from("communications").select("id", { count: "exact", head: true }).is("customer_id", null),
    supabase.from("calls").select("id", { count: "exact", head: true }).is("customer_id", null),
  ]);

  // ---- Birleştirme ---------------------------------------------------------
  const items: UnifiedItem[] = [];

  type CommRow = {
    id: string; channel: string; direction: string; subject: string | null;
    body: string | null; outcome: string | null; created_at: string;
    customer: EmbeddedCustomer | EmbeddedCustomer[] | null;
  };
  for (const r of (commRows ?? []) as unknown as CommRow[]) {
    const cust = embedded(r.customer);
    items.push({
      key: `c-${r.id}`,
      channel: r.channel,
      direction: r.direction,
      customerId: cust?.id ?? null,
      customerName: cust?.full_name ?? null,
      phone: cust?.phone ?? null,
      summary: truncate(r.body || r.subject || "—"),
      outcome: r.outcome ? (OUTCOME_LABELS.get(r.outcome) ?? r.outcome) : null,
      at: r.created_at,
    });
  }

  type CallRow = {
    id: string; direction: string; phone: string | null; disposition: string | null;
    notes: string | null; duration_sec: number | null; started_at: string;
    customer: EmbeddedCustomer | EmbeddedCustomer[] | null;
  };
  for (const r of ((callsRes.data ?? []) as unknown as CallRow[])) {
    const cust = embedded(r.customer);
    const durTxt = r.duration_sec ? ` · ${Math.round(r.duration_sec / 60)} dk` : "";
    items.push({
      key: `a-${r.id}`,
      channel: "call",
      direction: r.direction,
      customerId: cust?.id ?? null,
      customerName: cust?.full_name ?? null,
      phone: cust?.phone ?? r.phone ?? null,
      summary: truncate((r.notes || "Çağrı kaydı") + durTxt),
      outcome: r.disposition ? (OUTCOME_LABELS.get(r.disposition) ?? r.disposition) : null,
      at: r.started_at,
    });
  }

  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const pageItems = items.slice(offset, offset + PAGE_SIZE);

  // "Yanıtla" (tekil SMS) — sayfadaki müşterilerin İYS SMS onayları tek sorguda
  // çekilir; dialog onaysız müşteride gönderimi kilitleyip /app/uyum'a yönlendirir.
  const pageCustomerIds = [
    ...new Set(pageItems.map((i) => i.customerId).filter((v): v is string => Boolean(v))),
  ];
  const { data: smsConsents } = pageCustomerIds.length
    ? await supabase
        .from("iys_consents")
        .select("customer_id, status")
        .eq("channel", "sms")
        .in("customer_id", pageCustomerIds)
    : { data: [] as { customer_id: string; status: string }[] };
  const smsGrantedIds = new Set(
    (smsConsents ?? [])
      .filter((c) => c.status === "granted")
      .map((c) => String(c.customer_id)),
  );

  const totalFiltered = (commCount ?? 0) + (callsRes.count ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const rangeStart = totalFiltered === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + pageItems.length, totalFiltered);

  const kpiToday = (commInToday ?? 0) + (callInToday ?? 0);
  const kpiWeek = (commWeek ?? 0) + (callWeek ?? 0);
  const kpiUnmatched = (commUnmatched ?? 0) + (callUnmatched ?? 0);

  const todayParam = todayIso.slice(0, 10);
  const weekParam = weekAgoIso.slice(0, 10);

  // ---- Link kurucu — filtreler çip/sayfa linklerinde korunur ---------------
  const baseParams: Record<string, string> = {};
  if (q) baseParams.q = q;
  if (kanalF) baseParams.kanal = kanalF;
  if (fromF) baseParams.from = fromF;
  if (toF) baseParams.to = toF;
  if (unmatchedOnly) baseParams.durum = "eslesmemis";

  const hrefWith = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { ...baseParams, ...overrides };
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) usp.set(key, value);
    const qs = usp.toString();
    return qs ? `/app/gelen-kutusu?${qs}` : "/app/gelen-kutusu";
  };

  const hasAnyFilter = Boolean(q || kanalF || fromF || toF || unmatchedOnly);

  return (
    <div className="space-y-6">
      {/* Hero + KPI */}
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-brand-600/35 blur-[70px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
              <span className="status-pulse h-2 w-2 rounded-full bg-mint-400" /> İletişim akışı canlı
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Gelen Kutusu</h1>
            <p className="mt-1 text-sm text-white/60">
              SMS, WhatsApp, e-posta, çağrı ve notlar — tüm iletişim tek kronolojik akışta.
            </p>
          </div>
        </div>
        <div className="relative mt-6 grid grid-cols-3 gap-3">
          {[
            { label: "Bugün gelen", value: kpiToday, icon: ArrowDownLeft, href: `/app/gelen-kutusu?from=${todayParam}` },
            { label: "Bu hafta", value: kpiWeek, icon: CalendarClock, href: `/app/gelen-kutusu?from=${weekParam}` },
            { label: "Eşleşmemiş", value: kpiUnmatched, icon: UserX, href: "/app/gelen-kutusu?durum=eslesmemis" },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur transition hover:border-brand-300"
            >
              <div className="flex items-start justify-between">
                <item.icon className="h-4 w-4 text-mint-400" />
                <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
              </div>
              <p className="mt-2 font-display text-xl font-extrabold text-white">{item.value.toLocaleString("tr-TR")}</p>
              <p className="text-[11px] text-white/45 sm:text-xs">{item.label}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Filtreler — GET formu (sayfa 1'e döner) + kanal çipleri link olarak */}
      <div className="rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] space-y-3">
        <form className="flex flex-wrap items-center gap-3" action="/app/gelen-kutusu">
          {kanalF ? <input type="hidden" name="kanal" value={kanalF} /> : null}
          {unmatchedOnly ? <input type="hidden" name="durum" value="eslesmemis" /> : null}
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
            <input
              name="q"
              defaultValue={q}
              aria-label="Müşteri adına göre ara"
              placeholder="Müşteri adı ara…"
              className="w-full rounded-[11px] border border-line bg-canvas py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <span className="text-xs font-medium">Tarih:</span>
            <input
              name="from"
              type="date"
              defaultValue={fromF}
              className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
            />
            <span>—</span>
            <input
              name="to"
              type="date"
              defaultValue={toF}
              className="rounded-[9px] border border-line bg-canvas px-2.5 py-1.5 text-sm outline-none focus:border-brand-400"
            />
          </div>
          <button type="submit" className="rounded-[10px] bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700">
            Filtrele
          </button>
          {hasAnyFilter ? (
            <Link href="/app/gelen-kutusu" className="text-xs font-semibold text-text-muted hover:text-danger-500">
              Temizle
            </Link>
          ) : null}
          <span className="ml-auto rounded-full bg-brand-600/10 px-3 py-1.5 text-xs font-semibold text-brand-600">
            {totalFiltered.toLocaleString("tr-TR")} kayıt
          </span>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={hrefWith({ kanal: undefined, sayfa: undefined })}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${!kanalF ? "bg-brand-600 text-white" : "border border-line text-text-muted hover:border-brand-400 hover:text-brand-600"}`}
          >
            Tümü
          </Link>
          {COMM_CHANNELS.map((c) => (
            <Link
              key={c.value}
              href={hrefWith({ kanal: c.value, sayfa: undefined })}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${kanalF === c.value ? "bg-brand-600 text-white" : "border border-line text-text-muted hover:border-brand-400 hover:text-brand-600"}`}
            >
              {c.emoji} {c.label}
            </Link>
          ))}
          {unmatchedOnly ? (
            <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1.5 text-xs font-bold text-amber-600">
              <UserX className="h-3.5 w-3.5" /> Yalnız eşleşmemiş
              <Link href={hrefWith({ durum: undefined, sayfa: undefined })} className="ml-1 font-semibold hover:text-danger-500" aria-label="Eşleşmemiş filtresini kaldır">×</Link>
            </span>
          ) : null}
        </div>
        {/* Kayıtlı görünümler — aktif filtre kombinasyonu adlandırılıp saklanır */}
        <SavedViews route="/app/gelen-kutusu" views={savedViews} currentParams={baseParams} />
      </div>

      {/* Akış */}
      {pageItems.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={hasAnyFilter ? "Eşleşen kayıt bulunamadı" : "Gelen kutusu boş"}
          description={
            hasAnyFilter
              ? "Filtreleri değiştirip tekrar deneyin."
              : "SMS, çağrı ve iletişim kayıtları oluştukça burada tek akışta listelenir. Müşteri kartından iletişim notu ekleyerek başlayabilirsiniz."
          }
          action={hasAnyFilter ? { href: "/app/gelen-kutusu", label: "Filtreleri temizle" } : { href: "/app/musteriler", label: "Müşterilere git" }}
        />
      ) : (
        <ul className="overflow-hidden rounded-[16px] border border-line bg-surface shadow-[var(--shadow-xs)] divide-y divide-hairline">
          {pageItems.map((item) => {
            const meta = CHANNEL_META[item.channel] ?? CHANNEL_META.note;
            const Icon = item.direction === "missed" ? PhoneMissed : meta.icon;
            const telHref = toTelHref(item.phone);
            const waHref = toWhatsAppLink(item.phone);
            return (
              <li key={item.key} className="group relative flex items-start gap-3 px-4 py-3 transition hover:bg-canvas">
                {/* Satır overlay linki — müşteri kartına gider (müşterisizse link yok) */}
                {item.customerId ? (
                  <Link
                    href={`/app/musteriler/${item.customerId}`}
                    className="absolute inset-0"
                    aria-label={`${item.customerName ?? "Müşteri"} detayları`}
                  />
                ) : null}
                <span className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[11px] ${item.direction === "missed" ? "bg-danger-500/10 text-danger-500" : meta.cls}`}>
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {item.customerId ? (
                      <span className="font-semibold text-ink-950">{item.customerName}</span>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] font-bold text-amber-600">
                          <UserX className="h-3 w-3" /> Eşleşmemiş
                        </span>
                        {item.phone ? (
                          <span className="tabular-nums font-semibold text-ink-950">{formatTurkishPhone(item.phone)}</span>
                        ) : null}
                      </>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.direction === "inbound" ? "bg-mint-500/12 text-mint-600" : item.direction === "missed" ? "bg-danger-500/10 text-danger-500" : "bg-ink-950/5 text-text-muted"}`}>
                      {item.direction === "inbound" ? "Gelen" : item.direction === "missed" ? "Cevapsız" : item.direction === "internal" ? "Dahili" : "Giden"}
                    </span>
                    {item.outcome ? (
                      <span className="rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-text-muted">{item.outcome}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-sm text-text-muted">{item.summary}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* İkincil eylemler overlay'in üstünde kalmalı → relative z-10 */}
                  {item.customerId ? (
                    <SmsDialog
                      customerId={item.customerId}
                      customerName={item.customerName ?? "Müşteri"}
                      consentGranted={smsGrantedIds.has(item.customerId)}
                      variant="row"
                    />
                  ) : null}
                  {item.customerId ? (
                    <RowQuickActions
                      customerId={item.customerId}
                      customerName={item.customerName ?? "Müşteri"}
                      message={item.summary}
                    />
                  ) : null}
                  {telHref ? (
                    <a
                      href={telHref}
                      className="relative z-10 grid h-8 w-8 place-items-center rounded-[9px] text-text-faint transition hover:bg-brand-600/10 hover:text-brand-600"
                      aria-label="Numarayı ara"
                    >
                      <Phone className="h-4 w-4" />
                    </a>
                  ) : null}
                  {waHref ? (
                    <a
                      href={waHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="relative z-10 grid h-8 w-8 place-items-center rounded-[9px] text-text-faint transition hover:bg-mint-500/10 hover:text-mint-600"
                      aria-label="WhatsApp'tan yaz"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </a>
                  ) : null}
                  <span className="whitespace-nowrap text-xs text-text-faint" title={new Date(item.at).toLocaleString("tr-TR")}>
                    {relativeTime(item.at)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Sayfalama — filtre parametreleri linklerde korunur */}
      {totalFiltered > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="numeric text-text-muted">
            {rangeStart.toLocaleString("tr-TR")}–{rangeEnd.toLocaleString("tr-TR")} / Toplam{" "}
            {totalFiltered.toLocaleString("tr-TR")}
          </p>
          <div className="flex items-center gap-1.5">
            {page > 1 ? (
              <Link href={hrefWith({ sayfa: page - 1 > 1 ? String(page - 1) : undefined })} className={PAGER_BTN}>
                <ChevronLeft className="h-4 w-4" /> Önceki
              </Link>
            ) : (
              <span className={PAGER_BTN_DISABLED} aria-disabled="true">
                <ChevronLeft className="h-4 w-4" /> Önceki
              </span>
            )}
            <span className="numeric px-1 text-text-faint">
              {Math.min(page, totalPages)} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link href={hrefWith({ sayfa: String(page + 1) })} className={PAGER_BTN}>
                Sonraki <ChevronRight className="h-4 w-4" />
              </Link>
            ) : (
              <span className={PAGER_BTN_DISABLED} aria-disabled="true">
                Sonraki <ChevronRight className="h-4 w-4" />
              </span>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
