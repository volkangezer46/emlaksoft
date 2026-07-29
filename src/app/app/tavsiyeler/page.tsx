import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Gift,
  HeartHandshake,
  Link2,
  Search,
  Sparkles,
  Trophy,
  UserCheck,
} from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/app/stat-card";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/app/export-csv-button";
import { exportReferralsCsv } from "@/app/actions/export";
import { formatTurkishPhone, toTelHref } from "@/lib/phone";
import {
  ConvertReferralButton,
  CopyReferralLinkButton,
  ReferralLinkCreator,
  ReferralLinkToggle,
  ReferralNoteButton,
  ReferralStatusPills,
  SuggestedReferralButton,
  type CustomerOption,
  type StaffOption,
} from "./referral-actions";

/** Sayfa başına kayıt — liste standardı (musteriler deseni). */
const PAGE_SIZE = 50;

const PAGER_BTN =
  "focus-ring press inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 shadow-[var(--elev-1)] transition hover:bg-canvas";
const PAGER_BTN_DISABLED =
  "inline-flex items-center gap-1 rounded-[9px] border border-hairline bg-surface px-2.5 py-1.5 font-medium text-ink-950 opacity-40";

const STATUS_LABELS: Record<string, string> = {
  yeni: "Yeni",
  iletisim: "İletişimde",
  musteri: "Müşteri",
  kazanildi: "Kazanıldı",
  kayip: "Kayıp",
};

const STATUS_VARIANTS: Record<string, BadgeVariant> = {
  yeni: "info",
  iletisim: "warning",
  musteri: "default",
  kazanildi: "success",
  kayip: "danger",
};

const STATUS_KEYS = ["yeni", "iletisim", "musteri", "kazanildi", "kayip"] as const;

function rel<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function appBase() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

type ReferralRow = {
  id: string;
  referred_name: string;
  referred_phone: string;
  referred_note: string | null;
  staff_note: string | null;
  status: string;
  created_at: string;
  created_customer_id: string | null;
  referrer_customer_id: string | null;
  referrer: { id?: string; full_name?: string } | { id?: string; full_name?: string }[] | null;
};

type LinkRow = {
  id: string;
  public_token: string;
  is_active: boolean;
  click_count: number;
  reward_note: string | null;
  created_at: string;
  customer_id: string;
  staff_id: string | null;
  customer: { id?: string; full_name?: string } | { id?: string; full_name?: string }[] | null;
};

/**
 * Referans (tavsiye) programı yönetimi — /app/tavsiyeler.
 *
 * NPS anketinin devamı: 9-10 veren destekleyenlere kişiye özel link üretilir,
 * link public /tavsiye/[token] sayfasını açar, gelen adaylar burada takip
 * edilip tek tıkla müşteriye dönüştürülür. Modül kapısı `customers`.
 */
export default async function ReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{ durum?: string; q?: string; sayfa?: string }>;
}) {
  const { perms } = await requireModulePage("customers");
  const canEdit = (perms.customers ?? []).includes("edit");
  const canCreate = (perms.customers ?? []).includes("create");

  const supabase = await createClient();
  const sp = await searchParams;
  const durumF = STATUS_KEYS.includes((sp.durum ?? "") as (typeof STATUS_KEYS)[number]) ? sp.durum! : "";
  const q = sp.q ?? "";
  const page = Math.max(1, Number.parseInt(sp.sayfa ?? "", 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Arama terimi: .or() sözdizimini bozan karakterler ayıklanır (musteriler deseni).
  const term = q.trim().replace(/[%_,()]/g, " ").trim();

  const LIST_COLS =
    "id, referred_name, referred_phone, referred_note, staff_note, status, created_at, created_customer_id, referrer_customer_id, referrer:customers!referrals_referrer_customer_id_fkey(id, full_name)";

  let listQuery = supabase.from("referrals").select(LIST_COLS, { count: "exact" });
  if (durumF) listQuery = listQuery.eq("status", durumF);
  if (term) {
    const pattern = `%${term}%`;
    const orParts = [`referred_name.ilike.${pattern}`, `referred_phone.ilike.${pattern}`];
    const digits = term.replace(/\D/g, "");
    if (digits.length >= 3 && digits !== term) orParts.push(`referred_phone.ilike.%${digits}%`);
    listQuery = listQuery.or(orParts.join(","));
  }

  const [
    { data: referralRows, count: filteredCount },
    { count: totalReferrals },
    { count: activeLinkCount },
    { count: convertedCount },
    { count: wonCount },
    { data: linkRows },
    { data: linkCountRows },
    { data: customerRows },
    { data: staffRows },
    { data: promoterRows },
  ] = await Promise.all([
    listQuery.order("created_at", { ascending: false }).range(offset, offset + PAGE_SIZE - 1),
    // KPI sayıları — liste sayfalı olduğundan head-count ile gerçek toplamlar.
    supabase.from("referrals").select("id", { count: "exact", head: true }),
    supabase.from("referral_links").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .not("created_customer_id", "is", null),
    supabase.from("referrals").select("id", { count: "exact", head: true }).eq("status", "kazanildi"),
    supabase
      .from("referral_links")
      .select(
        "id, public_token, is_active, click_count, reward_note, created_at, customer_id, staff_id, customer:customers(id, full_name)",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("referrals").select("link_id").limit(5000),
    supabase
      .from("customers")
      .select("id, full_name, phone")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).limit(200),
    // NPS entegrasyonu: destekleyenler (9-10) — linki olmayanlar önerilecek.
    supabase
      .from("surveys")
      .select("customer_id, score, answered_at, customer:customers(id, full_name)")
      .gte("score", 9)
      .eq("status", "answered")
      .order("answered_at", { ascending: false })
      .limit(200),
  ]);

  const rows = (referralRows ?? []) as unknown as ReferralRow[];
  const links = (linkRows ?? []) as unknown as LinkRow[];
  const totalFiltered = filteredCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));
  const rangeStart = totalFiltered === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + rows.length, totalFiltered);

  // Link başına gelen tavsiye sayısı (tek sorgu, JS'te grupla).
  const perLink = new Map<string, number>();
  for (const r of (linkCountRows ?? []) as { link_id: string | null }[]) {
    if (!r.link_id) continue;
    perLink.set(r.link_id, (perLink.get(r.link_id) ?? 0) + 1);
  }

  const staff = ((staffRows ?? []) as StaffOption[]).slice();
  const staffById = new Map(staff.map((s) => [s.id, s.full_name]));
  const customers = (customerRows ?? []) as CustomerOption[];

  // Linki olan müşteriler (aktif/pasif fark etmez) öneri listesinden düşer.
  const linkedCustomerIds = new Set(links.map((l) => l.customer_id));
  const seenPromoter = new Set<string>();
  const promoters: { id: string; name: string }[] = [];
  for (const s of (promoterRows ?? []) as {
    customer_id: string;
    customer: { id?: string; full_name?: string } | { id?: string; full_name?: string }[] | null;
  }[]) {
    const cid = String(s.customer_id ?? "");
    if (!cid || seenPromoter.has(cid) || linkedCustomerIds.has(cid)) continue;
    seenPromoter.add(cid);
    promoters.push({ id: cid, name: rel(s.customer)?.full_name ?? "Müşteri" });
    if (promoters.length >= 8) break;
  }

  const baseParams: Record<string, string> = {};
  if (q) baseParams.q = q;
  if (durumF) baseParams.durum = durumF;
  const hrefWith = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { ...baseParams, ...overrides };
    const usp = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) usp.set(key, value);
    const qs = usp.toString();
    return qs ? `/app/tavsiyeler?${qs}` : "/app/tavsiyeler";
  };

  const base = appBase();
  const dateFmt = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-extrabold text-ink-950">
            <HeartHandshake className="h-6 w-6 text-brand-600" />
            Tavsiyeler
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Memnun müşteri yeni müşteri getirir. Kişiye özel link üretin, gelen tavsiyeleri takip edin.
          </p>
        </div>
        <Link
          href="/app/raporlar/memnuniyet"
          className="focus-ring press inline-flex items-center gap-1.5 rounded-[10px] border border-hairline-strong bg-surface px-3 py-2 text-xs font-semibold text-ink-950 transition hover:bg-canvas"
        >
          <Sparkles className="h-3.5 w-3.5 text-brand-600" />
          Memnuniyet raporu
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Aktif tavsiye linki"
          value={(activeLinkCount ?? 0).toLocaleString("tr-TR")}
          icon={Link2}
          href="/app/tavsiyeler#linkler"
        />
        <StatCard
          label="Gelen tavsiye"
          value={(totalReferrals ?? 0).toLocaleString("tr-TR")}
          icon={HeartHandshake}
          href="/app/tavsiyeler#gelenler"
        />
        <StatCard
          label="Müşteriye dönen"
          value={(convertedCount ?? 0).toLocaleString("tr-TR")}
          icon={UserCheck}
          href="/app/tavsiyeler?durum=musteri"
        />
        <StatCard
          label="Kazanılan anlaşma"
          value={(wonCount ?? 0).toLocaleString("tr-TR")}
          icon={Trophy}
          tone="success"
          href="/app/tavsiyeler?durum=kazanildi"
        />
      </div>

      {/* ---------------- Gelen tavsiyeler ---------------- */}
      <section id="gelenler" className="space-y-3">
        <form className="rounded-[16px] border border-line bg-surface p-4 shadow-[var(--shadow-xs)] space-y-3" action="/app/tavsiyeler">
          <div className="flex flex-wrap gap-3">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
              <input
                name="q"
                defaultValue={q}
                aria-label="Tavsiye ara"
                placeholder="Ad veya telefon ara…"
                className="w-full rounded-[11px] border border-line bg-canvas py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
              />
            </div>
            <select
              name="durum"
              defaultValue={durumF}
              aria-label="Durum filtresi"
              className="rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm outline-none focus:border-brand-400"
            >
              <option value="">Tüm durumlar</option>
              {STATUS_KEYS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-[10px] bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
            >
              Filtrele
            </button>
            {durumF || q ? (
              <Link href="/app/tavsiyeler" className="self-center text-xs font-semibold text-text-muted hover:text-danger-500">
                Temizle
              </Link>
            ) : null}
            <span className="ml-auto self-center rounded-full bg-brand-600/10 px-3 py-1.5 text-xs font-semibold text-brand-600">
              {totalFiltered.toLocaleString("tr-TR")} sonuç
            </span>
          </div>
        </form>

        {(totalReferrals ?? 0) === 0 ? (
          <div className="grid place-items-center rounded-[16px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-brand-600/10">
              <HeartHandshake className="h-7 w-7 text-brand-600" />
            </div>
            <h2 className="mt-4 font-display text-lg font-bold text-ink-950">Henüz tavsiye gelmedi</h2>
            <p className="mt-1 max-w-md text-sm text-text-muted">
              Aşağıdan memnun bir müşterinize tavsiye linki üretin ve kendisine gönderin. Linki açan
              tanıdıkları buraya düşer; tek tıkla müşteriye dönüştürürsünüz.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="grid place-items-center rounded-[18px] border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
            <Search className="h-8 w-8 text-text-faint" />
            <h2 className="mt-3 font-display text-lg font-bold text-ink-950">Eşleşen tavsiye bulunamadı</h2>
            <p className="mt-1 text-sm text-text-muted">Filtreyi değiştirip tekrar deneyin.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-end">
              <ExportCsvButton action={exportReferralsCsv} label="Dışa aktar" />
            </div>
            <TableFrame minWidth={980}>
            <Table>
              <THead>
                <TR>
                  <TH>Tavsiye edilen</TH>
                  <TH>Tavsiye eden</TH>
                  <TH>Durum</TH>
                  <TH>Tarih</TH>
                  <TH align="right">
                    <span className="sr-only">İşlemler</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((r) => {
                  const referrer = rel(r.referrer);
                  const tel = toTelHref(r.referred_phone);
                  return (
                    <TR key={r.id}>
                      <TD>
                        <span className="block font-semibold text-ink-950">{r.referred_name}</span>
                        {tel ? (
                          <a
                            href={tel}
                            className="numeric text-xs text-text-muted underline-offset-2 hover:text-brand-600 hover:underline"
                          >
                            {formatTurkishPhone(r.referred_phone)}
                          </a>
                        ) : (
                          <span className="numeric text-xs text-text-muted">
                            {formatTurkishPhone(r.referred_phone)}
                          </span>
                        )}
                        {r.referred_note ? (
                          <span className="mt-1 block max-w-[280px] text-xs leading-relaxed text-text-muted">
                            “{r.referred_note}”
                          </span>
                        ) : null}
                        {r.staff_note ? (
                          <span className="mt-1 block max-w-[280px] whitespace-pre-line text-[11px] leading-relaxed text-text-faint">
                            {r.staff_note}
                          </span>
                        ) : null}
                      </TD>
                      <TD>
                        {r.referrer_customer_id ? (
                          <Link
                            href={`/app/musteriler/${r.referrer_customer_id}`}
                            className="text-sm font-semibold text-brand-600 underline-offset-2 hover:underline"
                          >
                            {referrer?.full_name ?? "Müşteri"}
                          </Link>
                        ) : (
                          <span className="text-sm text-text-muted">—</span>
                        )}
                        {r.created_customer_id ? (
                          <Link
                            href={`/app/musteriler/${r.created_customer_id}`}
                            className="mt-1 block text-[11px] font-semibold text-mint-600 underline-offset-2 hover:underline"
                          >
                            Oluşan müşteri kaydı →
                          </Link>
                        ) : null}
                      </TD>
                      <TD>
                        {canEdit ? (
                          <ReferralStatusPills id={r.id} status={r.status} />
                        ) : (
                          <Badge variant={STATUS_VARIANTS[r.status] ?? "default"}>
                            {STATUS_LABELS[r.status] ?? r.status}
                          </Badge>
                        )}
                      </TD>
                      <TD>
                        <span className="numeric text-xs text-text-muted">
                          {dateFmt.format(new Date(r.created_at))}
                        </span>
                      </TD>
                      <TD align="right">
                        <div className="flex flex-wrap items-start justify-end gap-2">
                          {canCreate ? (
                            <ConvertReferralButton id={r.id} done={Boolean(r.created_customer_id)} />
                          ) : null}
                          {canEdit ? <ReferralNoteButton id={r.id} /> : null}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            </TableFrame>
          </>
        )}

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
      </section>

      {/* ---------------- Link üretimi ---------------- */}
      {canEdit ? (
        <section id="linkler" className="space-y-3">
          <ReferralLinkCreator customers={customers} staff={staff} />

          {promoters.length > 0 ? (
            <div className="rounded-[16px] border border-mint-500/30 bg-mint-500/5 p-4">
              <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
                <Sparkles className="h-4 w-4 text-mint-600" />
                Bunlar sizi tavsiye etmeye hazır
              </h2>
              <p className="mt-1 text-xs text-text-muted">
                Memnuniyet anketinde 9-10 puan veren destekleyenler — henüz tavsiye linkleri yok.
                Tek tıkla üretin, kendilerine gönderin.
              </p>
              <ul className="mt-3 space-y-1.5">
                {promoters.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-[11px] border border-line bg-surface px-3 py-2"
                  >
                    <Link
                      href={`/app/musteriler/${p.id}`}
                      className="text-sm font-semibold text-ink-950 underline-offset-2 hover:text-brand-600 hover:underline"
                    >
                      {p.name}
                    </Link>
                    <SuggestedReferralButton customerId={p.id} customerName={p.name} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="rounded-[16px] border border-line bg-surface shadow-[var(--shadow-xs)]">
            <div className="border-b border-line px-4 py-3">
              <h2 className="flex items-center gap-2 font-display text-sm font-bold text-ink-950">
                <Link2 className="h-4 w-4 text-brand-600" />
                Mevcut tavsiye linkleri
              </h2>
            </div>
            {links.length === 0 ? (
              <div className="grid place-items-center px-6 py-10 text-center">
                <Gift className="h-7 w-7 text-text-faint" />
                <p className="mt-2 text-sm font-semibold text-ink-950">Henüz tavsiye linki üretmediniz</p>
                <p className="mt-1 max-w-sm text-xs text-text-muted">
                  En memnun müşterinizle başlayın — yukarıdaki bölümden seçin, linki kopyalayıp
                  WhatsApp&apos;tan gönderin.
                </p>
              </div>
            ) : (
              <TableFrame minWidth={820}>
                <Table>
                  <THead>
                    <TR>
                      <TH>Müşteri</TH>
                      <TH>Danışman</TH>
                      <TH align="right">Tıklanma</TH>
                      <TH align="right">Gelen tavsiye</TH>
                      <TH>Aktif</TH>
                      <TH align="right">
                        <span className="sr-only">İşlemler</span>
                      </TH>
                    </TR>
                  </THead>
                  <TBody>
                    {links.map((l) => {
                      const c = rel(l.customer);
                      return (
                        <TR key={l.id}>
                          <TD>
                            <Link
                              href={`/app/musteriler/${l.customer_id}`}
                              className="font-semibold text-ink-950 underline-offset-2 hover:text-brand-600 hover:underline"
                            >
                              {c?.full_name ?? "Müşteri"}
                            </Link>
                            {l.reward_note ? (
                              <span className="mt-0.5 block max-w-[260px] text-[11px] text-text-muted">
                                🎁 {l.reward_note}
                              </span>
                            ) : null}
                          </TD>
                          <TD>
                            <span className="text-xs text-text-muted">
                              {l.staff_id ? (staffById.get(l.staff_id) ?? "—") : "Atanmadı"}
                            </span>
                          </TD>
                          <TD align="right">
                            <span className="numeric text-sm text-ink-950">
                              {(l.click_count ?? 0).toLocaleString("tr-TR")}
                            </span>
                          </TD>
                          <TD align="right">
                            <span className="numeric text-sm font-semibold text-ink-950">
                              {(perLink.get(l.id) ?? 0).toLocaleString("tr-TR")}
                            </span>
                          </TD>
                          <TD>
                            <ReferralLinkToggle id={l.id} active={l.is_active} />
                          </TD>
                          <TD align="right">
                            <CopyReferralLinkButton url={`${base}/tavsiye/${l.public_token}`} />
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </TableFrame>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
