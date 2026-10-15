import Link from "@/components/ui/smart-link";
import {
  ArrowLeft,
  ExternalLink,
  Inbox,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  UserX,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { now } from "@/lib/clock";
import { relativeTimeTr, waitingLabel } from "@/lib/relative-time";
import { formatTurkishPhone, toTelHref, toWhatsAppLink } from "@/lib/phone";
import { buildHref, mergeParams, type ParamRecord } from "@/lib/ui/filter-params";
import { PageHeader } from "@/components/ui/page-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { FilterChip } from "@/components/ui/filter-chip";
import { EmptyState } from "@/components/ui/empty-state";
import { ButtonLink } from "@/components/ui/button";
import { ListPager } from "@/components/ui/list-kit/list-pager";
import { pageWindow } from "@/components/ui/list-kit/list-logic";
import { whatsappWindowState, windowLabel } from "@/lib/messaging/whatsapp-window";
import { isTenantWhatsAppSessionReady } from "@/lib/messaging/tenant-providers";
import { cn } from "@/lib/utils";
import { formatDateTimeTr } from "@/lib/format";
import { ResolveConversationButton } from "./conversation-actions";
import { SmsComposer } from "./sms-panel";
import { WhatsAppWindowReply } from "./whatsapp-window-reply";
import { LinkToCustomer } from "./link-to-customer";

/**
 * Gelen kutusu v2 — KONUŞMALAR (varsayılan sekme).
 *
 * Kayıtlar kişi bazında konuşmaya toplanır (`inbox_conversations` RPC, migration 20261018060100): müşteri ya da eşleşmemiş
 * numara. "Yanıt bekliyor" = son temastan sonra gelen ve "tamamlandı" işaretlenmemiş WhatsApp/SMS/e-posta ya da cevapsız
 * arama; giden yanıt konuşmayı kendiliğinden kapatır. Sorumlu = müşterinin danışmanı (`?danisman=ben|<id>`).
 * Konuşma `?customer=<id>` ya da `?tel=<son 10 hane>` ile açılır: masaüstünde sağda, mobilde tam ekran.
 */

const PAGE_SIZE = 30;
const THREAD_LIMIT = 50;
const PATH = "/app/gelen-kutusu";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATES = [
  { value: "", label: "Yanıt bekliyor" },
  { value: "tumu", label: "Tümü" },
  { value: "kapanan", label: "Tamamlanan" },
] as const;

const CHANNEL_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  whatsapp: MessageCircle,
  sms: MessageSquare,
  email: Mail,
  meeting: Users,
};
const CHANNEL_LABEL: Record<string, string> = {
  call: "Arama",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "E-posta",
  meeting: "Görüşme",
};

type ConvRow = {
  contact_key: string;
  customer_id: string | null;
  customer_name: string | null;
  assigned_to: string | null;
  phone: string | null;
  last_at: string;
  last_channel: string;
  last_direction: string;
  last_body: string | null;
  waiting_since: string | null;
  waiting_count: number;
  total_count: number | string;
};

type ThreadItem = {
  key: string;
  id: string;
  kind: "comm" | "call";
  channel: string;
  direction: string;
  body: string;
  at: string;
};

function oneLine(text: string | null, max = 90): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

const TONE_CLS = {
  normal: "bg-brand-600/10 text-brand-700",
  warn: "bg-amber-400/15 text-amber-700",
  urgent: "bg-danger-500/10 text-danger-600",
} as const;

export async function ConversationsView({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { userId, tenantId } = await requireModulePage("calls");
  const sp = await searchParams;
  const supabase = await createClient();

  const state = sp.durum === "tumu" || sp.durum === "kapanan" ? sp.durum : "";
  const danisman = sp.danisman === "ben" ? "ben" : sp.danisman && UUID_RE.test(sp.danisman) ? sp.danisman : "";
  const assignee = danisman === "ben" ? userId : danisman || null;
  const q = (sp.q ?? "").trim().replace(/[%_\\]/g, " ").trim().slice(0, 80);
  const page = Math.max(1, Number.parseInt(sp.sayfa ?? "", 10) || 1);
  const selCustomer = sp.customer && UUID_RE.test(sp.customer) ? sp.customer : null;
  const selTel = !selCustomer && sp.tel && /^\d{7,10}$/.test(sp.tel) ? sp.tel : null;
  const selectedKey = selCustomer ? `c:${selCustomer}` : selTel ? `t:${selTel}` : null;

  const params: ParamRecord = {};
  if (state) params.durum = state;
  if (danisman) params.danisman = danisman;
  if (q) params.q = q;
  const listHref = (patch: ParamRecord = {}) => buildHref(PATH, mergeParams(params, patch));
  const openHref = (row: { customer_id: string | null; contact_key: string }) =>
    row.customer_id
      ? listHref({ customer: row.customer_id, sayfa: page > 1 ? String(page) : undefined })
      : listHref({ tel: row.contact_key.slice(2), sayfa: page > 1 ? String(page) : undefined });

  const rpcState = state || "bekliyor";
  const [listRes, waitingRes, advisorsRes, thread] = await Promise.all([
    supabase.rpc("inbox_conversations", {
      p_state: rpcState,
      p_assignee: assignee,
      p_q: q || null,
      p_limit: PAGE_SIZE,
      p_offset: (page - 1) * PAGE_SIZE,
    }),
    // "Yanıt bekliyor" sayacı (süzgeçsiz, danışman süzgeciyle aynı kapsam)
    supabase.rpc("inbox_conversations", { p_state: "bekliyor", p_assignee: assignee, p_q: null, p_limit: 1, p_offset: 0 }),
    supabase.from("profiles").select("id, full_name").eq("tenant_id", tenantId ?? "").eq("is_active", true).order("full_name").limit(200),
    selectedKey ? loadThread(supabase, selCustomer, selTel) : Promise.resolve(null),
  ]);

  const available = !listRes.error;
  const rows = ((listRes.data ?? []) as ConvRow[]).map((r) => ({ ...r, waiting_count: Number(r.waiting_count) }));
  const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
  const waitingRows = (waitingRes.data ?? []) as ConvRow[];
  const waitingTotal = waitingRows.length > 0 ? Number(waitingRows[0]!.total_count) : 0;
  const advisors = ((advisorsRes.data ?? []) as { id: string; full_name: string | null }[]).map((a) => ({
    id: a.id,
    name: a.full_name?.trim() || "Adsız kullanıcı",
  }));
  const advisorName = new Map(advisors.map((a) => [a.id, a.name]));
  const pager = pageWindow(page, total, PAGE_SIZE, rows.length);

  // Seçili konuşmanın başlık bilgisi: listede varsa oradan, yoksa (ör. müşteri kartından gelinen bağlantı) ayrı okunur.
  const selectedRow = selectedKey ? (rows.find((r) => r.contact_key === selectedKey) ?? null) : null;
  let header: { name: string | null; phone: string | null; customerId: string | null; waiting: boolean; assignedTo: string | null } | null = null;
  if (selectedKey) {
    if (selectedRow) {
      header = {
        name: selectedRow.customer_name,
        phone: selectedRow.phone,
        customerId: selectedRow.customer_id,
        waiting: Boolean(selectedRow.waiting_since),
        assignedTo: selectedRow.assigned_to,
      };
    } else if (selCustomer) {
      const { data: c } = await supabase.from("customers").select("full_name, phone, assigned_to").eq("id", selCustomer).maybeSingle();
      header = { name: c?.full_name ?? null, phone: c?.phone ?? null, customerId: selCustomer, waiting: false, assignedTo: c?.assigned_to ?? null };
    } else {
      header = { name: null, phone: null, customerId: null, waiting: false, assignedTo: null };
    }
    if (!selectedRow && thread && thread.length > 0) {
      // Listede değilse bekleme durumu konuşmanın son kayıtlarından türetilir (sunucu kuralıyla aynı).
      let lastContact = -Infinity;
      for (const t of thread) {
        if (t.direction === "outbound" || (t.kind === "call" && t.direction === "inbound")) lastContact = Math.max(lastContact, Date.parse(t.at));
      }
      header.waiting = thread.some(
        (t) => !t.resolved && Date.parse(t.at) > lastContact && ((t.kind === "comm" && t.direction === "inbound" && ["whatsapp", "sms", "email"].includes(t.channel)) || (t.kind === "call" && t.direction === "missed")),
      );
    }
    if (!header.phone && selTel) header.phone = `0${selTel}`;
  }

  // Yanıt kanalları: SMS (İYS onayı) ve WhatsApp pencere içi yanıt (son gelen WA mesajı + ofis entegrasyonu)
  const lastInboundWa = thread ? [...thread].reverse().find((t) => t.kind === "comm" && t.channel === "whatsapp" && t.direction === "inbound") : undefined;
  const [smsConsent, waReady] = await Promise.all([
    header?.customerId
      ? supabase.from("iys_consents").select("status").eq("channel", "sms").eq("customer_id", header.customerId).maybeSingle()
      : Promise.resolve({ data: null }),
    lastInboundWa && tenantId ? isTenantWhatsAppSessionReady(tenantId).catch(() => false) : Promise.resolve(false),
  ]);
  const smsGranted = (smsConsent.data as { status?: string } | null)?.status === "granted";

  const hasFilter = Boolean(q || danisman || state);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Gelen Kutusu"
        description="Müşteri ve numara bazında konuşmalar. Yanıt bekleyenler önce; yanıt verdiğinizde ya da “Tamamlandı” dediğinizde kapanır."
        actions={
          <ButtonLink href="/app/gelen-kutusu?sekme=akis" variant="outline" icon={Inbox}>
            Tüm akış
          </ButtonLink>
        }
      />

      <div className={cn("space-y-3", selectedKey && "hidden lg:block")}>
        <FilterBar
          pathname={PATH}
          params={params}
          searchPlaceholder="Ad, telefon veya mesaj ara…"
          searchLabel="Konuşmalarda ara"
          resultCount={available ? total : undefined}
          resultNoun="konuşma"
        />
        <nav aria-label="Konuşma durumu" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          {STATES.map((s) => (
            <FilterChip
              key={s.value || "bekliyor"}
              href={listHref({ durum: s.value || undefined, sayfa: undefined, customer: undefined, tel: undefined })}
              active={state === s.value}
              count={s.value === "" ? waitingTotal : undefined}
            >
              {s.label}
            </FilterChip>
          ))}
          <FilterChip
            href={listHref({ danisman: danisman === "ben" ? undefined : "ben", sayfa: undefined })}
            active={danisman === "ben"}
          >
            Bana atananlar
          </FilterChip>
        </nav>
      </div>

      {!available ? (
        <EmptyState
          icon={Inbox}
          title="Konuşmalar henüz etkin değil"
          description="Konuşma görünümü için veritabanı güncellemesi bekleniyor. Bu arada tüm iletişim kayıtlarını akışta görebilirsiniz."
          action={{ href: "/app/gelen-kutusu?sekme=akis", label: "Tüm akışı aç" }}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
          {/* Konuşma listesi — mobilde konuşma açıkken gizlenir */}
          <section aria-label="Konuşmalar" className={cn("min-w-0 space-y-3", selectedKey && "hidden lg:block")}>
            {rows.length === 0 ? (
              <EmptyState
                illustration="gelenKutusu"
                icon={Inbox}
                title={hasFilter ? (state === "" ? "Yanıt bekleyen konuşma yok" : "Eşleşen konuşma bulunamadı") : "Yanıt bekleyen konuşma yok"}
                description={
                  state === "" && !q
                    ? "Tüm gelen mesajlar yanıtlanmış ya da tamamlanmış. Yeni WhatsApp, SMS veya cevapsız arama geldiğinde burada görünür."
                    : "Aramayı ya da süzgeçleri değiştirip tekrar deneyin."
                }
                action={state === "" ? { href: listHref({ durum: "tumu" }), label: "Tüm konuşmaları göster" } : { href: PATH, label: "Süzgeçleri temizle" }}
              />
            ) : (
              <ul className="divide-y divide-hairline overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-xs)]">
                {rows.map((r) => {
                  const Icon = r.last_channel === "call" ? (r.last_direction === "missed" ? PhoneMissed : Phone) : (CHANNEL_ICON[r.last_channel] ?? MessageSquare);
                  const wait = r.waiting_since ? waitingLabel(r.waiting_since) : null;
                  const active = r.contact_key === selectedKey;
                  const owner = r.assigned_to ? advisorName.get(r.assigned_to) : null;
                  const preview = r.last_channel === "call"
                    ? `${r.last_direction === "missed" ? "Cevapsız arama" : r.last_direction === "inbound" ? "Gelen arama" : "Giden arama"}${r.last_body ? ` · ${oneLine(r.last_body, 60)}` : ""}`
                    : `${r.last_direction === "outbound" ? "Siz: " : ""}${oneLine(r.last_body) || CHANNEL_LABEL[r.last_channel] || "Mesaj"}`;
                  return (
                    <li key={r.contact_key} className="relative">
                      <Link
                        href={openHref(r)}
                        aria-current={active ? "true" : undefined}
                        className={cn(
                          "focus-ring flex min-h-16 items-start gap-3 px-4 py-3 transition hover:bg-canvas",
                          active && "bg-brand-600/6",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full",
                            r.last_direction === "missed" ? "bg-danger-500/10 text-danger-500" : "bg-brand-600/10 text-brand-600",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className={cn("truncate text-sm text-ink-950", wait ? "font-bold" : "font-semibold")}>
                              {r.customer_id ? (r.customer_name ?? "Müşteri") : formatTurkishPhone(r.phone ?? "") || "Bilinmeyen numara"}
                            </span>
                            <span className="shrink-0 text-xs text-text-faint" title={formatDateTimeTr(r.last_at)}>
                              {relativeTimeTr(r.last_at)}
                            </span>
                          </span>
                          <span className={cn("mt-0.5 block truncate text-sm", wait ? "text-ink-950" : "text-text-muted")}>{preview}</span>
                          <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                            {wait ? (
                              <span className={cn("rounded-full px-2 py-0.5 font-semibold", TONE_CLS[wait.tone])}>
                                Yanıt bekliyor · {wait.text}
                                {r.waiting_count > 1 ? ` · ${r.waiting_count} mesaj` : ""}
                              </span>
                            ) : null}
                            {!r.customer_id ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-700">
                                <UserX className="h-3 w-3" /> Eşleşmemiş
                              </span>
                            ) : (
                              <span className="text-text-faint">{owner ? owner : "Danışman atanmamış"}</span>
                            )}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <ListPager pathname={PATH} params={params} window={pager} total={total} />
          </section>

          {/* Konuşma paneli — masaüstünde sağda, mobilde tam ekran */}
          {selectedKey && header ? (
            <section aria-label="Konuşma" className="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface shadow-[var(--shadow-xs)]">
              <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2.5 sm:px-4">
                <Link
                  href={listHref({ sayfa: page > 1 ? String(page) : undefined })}
                  className="focus-ring grid h-9 w-9 touch:h-11 touch:w-11 place-items-center rounded-[var(--radius-control)] text-text-muted hover:bg-canvas lg:hidden"
                  aria-label="Konuşma listesine dön"
                >
                  <ArrowLeft className="h-4 w-4" />
                </Link>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display font-bold text-ink-950">
                    {header.name ?? (formatTurkishPhone(header.phone ?? "") || "Bilinmeyen numara")}
                  </p>
                  <p className="truncate text-xs text-text-muted">
                    {header.name && header.phone ? formatTurkishPhone(header.phone) : !header.customerId ? "Eşleşmemiş numara" : ""}
                    {header.customerId ? ` · ${header.assignedTo ? (advisorName.get(header.assignedTo) ?? "Danışman") : "Danışman atanmamış"}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {toTelHref(header.phone) ? (
                    <a
                      href={toTelHref(header.phone)!}
                      className="focus-ring grid h-9 w-9 touch:h-11 touch:w-11 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted hover:text-brand-600"
                      aria-label="Ara"
                    >
                      <Phone className="h-4 w-4" />
                    </a>
                  ) : null}
                  {toWhatsAppLink(header.phone) ? (
                    <a
                      href={toWhatsAppLink(header.phone)!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="focus-ring grid h-9 w-9 touch:h-11 touch:w-11 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted hover:text-mint-700"
                      aria-label="WhatsApp'ta aç"
                    >
                      <MessageCircle className="h-4 w-4" />
                    </a>
                  ) : null}
                  {header.customerId ? (
                    <Link
                      href={`/app/musteriler/${header.customerId}`}
                      className="focus-ring grid h-9 w-9 touch:h-11 touch:w-11 place-items-center rounded-[var(--radius-control)] border border-line text-text-muted hover:text-brand-600"
                      aria-label="Müşteri kartını aç"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  ) : null}
                  <ResolveConversationButton contactKey={selectedKey} waiting={header.waiting} compact />
                </div>
              </div>

              {!thread || thread.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-text-muted">Son 90 günde bu kişiyle kayıtlı iletişim yok.</p>
              ) : (
                <ol className="max-h-[60vh] space-y-2 overflow-y-auto px-3 py-4 sm:px-4 lg:max-h-[calc(100vh-22rem)]" aria-label="Mesajlar">
                  {thread.map((t) => {
                    if (t.kind === "call" || !["whatsapp", "sms", "email"].includes(t.channel)) {
                      const CallIcon = t.direction === "missed" ? PhoneMissed : t.direction === "inbound" ? PhoneIncoming : t.channel === "call" ? PhoneOutgoing : (CHANNEL_ICON[t.channel] ?? Users);
                      return (
                        <li key={t.key} className="flex justify-center">
                          <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-xs", t.direction === "missed" ? "bg-danger-500/10 text-danger-600" : "bg-ink-950/5 text-text-muted")}>
                            <CallIcon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">
                              {t.kind === "call"
                                ? t.direction === "missed" ? "Cevapsız arama" : t.direction === "inbound" ? "Gelen arama" : "Giden arama"
                                : CHANNEL_LABEL[t.channel] ?? "Kayıt"}
                              {t.body ? ` · ${oneLine(t.body, 60)}` : ""} · {relativeTimeTr(t.at)}
                            </span>
                          </span>
                        </li>
                      );
                    }
                    const mine = t.direction === "outbound";
                    return (
                      <li key={t.key} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                        <div
                          className={cn(
                            "max-w-[85%] rounded-[var(--radius-card)] px-3 py-2 text-sm",
                            mine ? "bg-brand-600/10 text-ink-950" : "border border-line bg-canvas text-ink-950",
                          )}
                        >
                          <p className="whitespace-pre-line break-words">{t.body || "—"}</p>
                          <p className="mt-1 text-right text-xs text-text-faint">
                            {CHANNEL_LABEL[t.channel]} · <time dateTime={t.at} title={formatDateTimeTr(t.at)}>{relativeTimeTr(t.at)}</time>
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}

              {/* Yanıt alanı */}
              <div className="space-y-2 border-t border-hairline">
                {lastInboundWa ? (
                  <div className="px-4 pt-3">
                    {(() => {
                      const win = whatsappWindowState(lastInboundWa.at, now());
                      return <WhatsAppWindowReply communicationId={lastInboundWa.id} open={win.open} label={windowLabel(win)} channelReady={waReady} />;
                    })()}
                  </div>
                ) : null}
                {header.customerId ? (
                  <SmsComposer customerId={header.customerId} consentGranted={smsGranted} />
                ) : thread && thread.length > 0 ? (
                  <div className="p-4">
                    <p className="text-sm text-text-muted">Yanıt vermek ve geçmişi müşteriyle görmek için numarayı bir müşteriye bağlayın.</p>
                    <LinkToCustomer
                      kind={thread[thread.length - 1]!.kind}
                      recordId={thread[thread.length - 1]!.id}
                      phone={header.phone}
                    />
                  </div>
                ) : null}
              </div>
            </section>
          ) : (
            <div className="hidden min-h-64 place-items-center rounded-[var(--radius-card)] border border-dashed border-line-strong p-8 text-center text-sm text-text-muted lg:grid">
              <div>
                <MessageSquare className="mx-auto mb-2 h-6 w-6 text-text-faint" />
                Bir konuşma seçin: mesaj geçmişi ve yanıt alanı burada açılır.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type ThreadRow = ThreadItem & { resolved: boolean };

/** Konuşmanın son 50 kaydı (iletişim + arama), eskiden yeniye. */
async function loadThread(
  supabase: Awaited<ReturnType<typeof createClient>>,
  customerId: string | null,
  tel: string | null,
): Promise<ThreadRow[]> {
  let comm = supabase
    .from("communications")
    .select("id, channel, direction, subject, body, created_at, resolved_at")
    .neq("channel", "note")
    .neq("direction", "internal")
    .order("created_at", { ascending: false })
    .limit(THREAD_LIMIT);
  let calls = supabase
    .from("calls")
    .select("id, direction, notes, started_at, resolved_at")
    .order("started_at", { ascending: false })
    .limit(THREAD_LIMIT);
  if (customerId) {
    comm = comm.eq("customer_id", customerId);
    calls = calls.eq("customer_id", customerId);
  } else {
    comm = comm.is("customer_id", null).ilike("contact_address", `%${tel}`);
    calls = calls.is("customer_id", null).ilike("phone", `%${tel}`);
  }
  const [c, a] = await Promise.all([comm, calls]);
  const out: ThreadRow[] = [];
  for (const r of (c.data ?? []) as { id: string; channel: string; direction: string; subject: string | null; body: string | null; created_at: string; resolved_at: string | null }[]) {
    out.push({ key: `c-${r.id}`, id: r.id, kind: "comm", channel: r.channel, direction: r.direction, body: (r.body || r.subject || "").trim(), at: r.created_at, resolved: Boolean(r.resolved_at) });
  }
  for (const r of (a.data ?? []) as { id: string; direction: string; notes: string | null; started_at: string; resolved_at: string | null }[]) {
    out.push({ key: `a-${r.id}`, id: r.id, kind: "call", channel: "call", direction: r.direction, body: (r.notes ?? "").trim(), at: r.started_at, resolved: Boolean(r.resolved_at) });
  }
  out.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  return out.slice(-THREAD_LIMIT);
}
