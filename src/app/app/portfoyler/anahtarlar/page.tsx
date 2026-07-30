import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  Building2,
  KeyRound,
  LogOut,
  Search,
  Siren,
  Undo2,
  UserRound,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { EmptyState } from "@/components/app/empty-state";
import { StatCard } from "@/components/app/stat-card";
import { returnPropertyKey } from "@/app/actions/property-keys";
import { orIlike, inFilter } from "@/lib/pgrst";
import { now } from "@/lib/clock";
import {
  KEY_BOARD_FILTERS,
  isKeyOut,
  keyHolderLabel,
  keyOverdueDays,
  keyStatusLabel,
  keyStatusTone,
} from "@/lib/key-overdue";

/**
 * Anahtar panosu — ofis genelinde "hangi anahtar kimde?".
 *
 * Portföy detayındaki bölüm tek portföyü anlatır; bu sayfa TÜM anahtarları
 * tek ekranda toplar. Asıl değeri "gecikmiş" sütunudur: vadesi geçmiş ve
 * iade edilmemiş anahtarlar (aynı tanım src/lib/key-overdue.ts'te, cron da
 * onu kullanır).
 *
 * Kapı: modül "properties" (ayrı modül kaydı yok — portföyün altında yaşar).
 * Filtre kontratı: ?durum= (ofiste|disarida|gecikmis|kayip) · ?danisman= ·
 * ?q= (portföy kodu/başlık/etiket/kişi) · ?sayfa= (50'lik gerçek sayfalama).
 */

const PAGE_SIZE = 50;
const dtf = new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" });

type KeyRow = {
  id: string;
  label: string;
  key_code: string | null;
  status: string;
  holder_staff_id: string | null;
  holder_name: string | null;
  holder_phone: string | null;
  taken_at: string | null;
  due_at: string | null;
  returned_at: string | null;
  property: { id: string; property_code: string; title: string | null } | { id: string; property_code: string; title: string | null }[] | null;
  holder: { full_name: string | null } | { full_name: string | null }[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function shortDate(value: string | null) {
  return value ? dtf.format(new Date(value)) : "—";
}

export default async function PropertyKeysBoardPage({
  searchParams,
}: {
  searchParams?: Promise<{ durum?: string; danisman?: string; q?: string; sayfa?: string }>;
}) {
  await requireModulePage("properties");
  const { durum = "", danisman = "", q = "", sayfa = "" } = (await searchParams) ?? {};
  const query = q.trim();
  const supabase = await createClient();
  const nowMs = now();
  const nowIso = new Date(nowMs).toISOString();
  // Dışarıda sayılan durumlar + gecikme tanımı SQL'e taşındı (bkz. key-overdue.ts).
  const OUT_STATUSES = ["danisanda", "musteride"];

  // Arama: portföy kodu/başlık geo tabloları gibi ayrı bir tabloda olduğu için
  // önce eşleşen portföy id'leri bulunur, sonra anahtar etiketi/kişi adıyla
  // birlikte tek or() koşuluna eklenir (portfoyler/page.tsx deseni).
  let propertyIdHits: string[] = [];
  if (query) {
    const { data: propHits } = await supabase
      .from("properties")
      .select("id")
      .is("deleted_at", null)
      .or(orIlike(["property_code", "title"], query))
      .limit(200);
    propertyIdHits = (propHits ?? []).map((r) => r.id as string);
  }

  // Paylaşılan filtre (durum HARİÇ — sayaçlar birbirine göre okunsun): ?danisman= + ?q=.
  const orClause = query
    ? [orIlike(["label", "key_code", "holder_name"], query), inFilter("property_id", propertyIdHits)]
        .filter(Boolean)
        .join(",")
    : null;

  // Sayaç fabrikası — head:true (satır çekmeden yalnız COUNT). destek/page.tsx deseni.
  function baseCount() {
    let b = supabase.from("property_keys").select("id", { count: "exact", head: true });
    if (danisman) b = b.eq("holder_staff_id", danisman);
    if (orClause) b = b.or(orClause);
    return b;
  }
  const headCount = (patch: (b: ReturnType<typeof baseCount>) => ReturnType<typeof baseCount>) => patch(baseCount());

  const page = Math.max(1, Number.parseInt(sayfa, 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  // Liste: sunucu tarafı durum filtresi + gerçek .range() + count:"exact" (musteriler deseni).
  let listQuery = supabase
    .from("property_keys")
    .select(
      "id, label, key_code, status, holder_staff_id, holder_name, holder_phone, taken_at, due_at, returned_at, property:properties!property_keys_property_id_fkey(id, property_code, title), holder:profiles!property_keys_holder_staff_id_fkey(full_name)",
      { count: "exact" },
    )
    .order("due_at", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (danisman) listQuery = listQuery.eq("holder_staff_id", danisman);
  if (orClause) listQuery = listQuery.or(orClause);
  if (durum === "ofiste") listQuery = listQuery.eq("status", "ofiste");
  else if (durum === "disarida") listQuery = listQuery.in("status", OUT_STATUSES);
  else if (durum === "kayip") listQuery = listQuery.eq("status", "kayip");
  else if (durum === "gecikmis")
    listQuery = listQuery.in("status", OUT_STATUSES).lt("due_at", nowIso).is("returned_at", null);

  const [listRes, officeRes, outRes, overdueRes, lostRes, baseRes, staffRes] = await Promise.all([
    listQuery.range(offset, offset + PAGE_SIZE - 1),
    headCount((b) => b.eq("status", "ofiste")),
    headCount((b) => b.in("status", OUT_STATUSES)),
    headCount((b) => b.in("status", OUT_STATUSES).lt("due_at", nowIso).is("returned_at", null)),
    headCount((b) => b.eq("status", "kayip")),
    headCount((b) => b),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);

  const pageRows = (listRes.data ?? []) as KeyRow[];
  const staff = (staffRes.data ?? []) as { id: string; full_name: string | null }[];
  const officeCount = officeRes.count ?? 0;
  const outCount = outRes.count ?? 0;
  const overdueCount = overdueRes.count ?? 0;
  const lostCount = lostRes.count ?? 0;
  const baseTotal = baseRes.count ?? 0; // durum filtresi olmadan (q/danisman uygulanmış) toplam
  const totalFiltered = listRes.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / PAGE_SIZE));

  // Filtre linkleri sayfa numarasını sıfırlar (portallar/page.tsx deseni).
  const href = (over: { durum?: string; danisman?: string; q?: string; sayfa?: number }) => {
    const sp = new URLSearchParams();
    const d = over.durum !== undefined ? over.durum : durum;
    const a = over.danisman !== undefined ? over.danisman : danisman;
    const s = over.q !== undefined ? over.q : query;
    if (d) sp.set("durum", d);
    if (a) sp.set("danisman", a);
    if (s) sp.set("q", s);
    if (over.sayfa && over.sayfa > 1) sp.set("sayfa", String(over.sayfa));
    const qs = sp.toString();
    return qs ? `/app/portfoyler/anahtarlar?${qs}` : "/app/portfoyler/anahtarlar";
  };

  const activeStaff = danisman ? staff.find((s) => s.id === danisman) ?? null : null;
  const hasFilter = Boolean(durum || danisman || query);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/app/portfoyler"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
        >
          <ArrowLeft className="h-4 w-4" /> Portföy merkezine dön
        </Link>
      </div>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-mint-500/20 blur-[80px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-mint-400">
            <KeyRound className="h-3.5 w-3.5" /> Anahtar &amp; emanet
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Anahtar panosu</h1>
          <p className="mt-1 text-sm text-white/60">
            Ofisteki, dışarıdaki ve iadesi geciken tüm anahtarlar tek ekranda.
          </p>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ofiste" value={officeCount} icon={Building2} tone="success" href={href({ durum: "ofiste", sayfa: 1 })} />
        <StatCard label="Dışarıda" value={outCount} icon={LogOut} tone="warning" href={href({ durum: "disarida", sayfa: 1 })} />
        <StatCard
          label="Gecikmiş iade"
          value={overdueCount}
          icon={AlertTriangle}
          tone={overdueCount > 0 ? "danger" : "warning"}
          href={href({ durum: "gecikmis", sayfa: 1 })}
        />
        <StatCard label="Kayıp" value={lostCount} icon={Siren} tone="danger" href={href({ durum: "kayip", sayfa: 1 })} />
      </div>

      <form
        action="/app/portfoyler/anahtarlar"
        className="flex flex-wrap items-center gap-3 rounded-[16px] border border-line bg-surface p-3 shadow-[var(--shadow-xs)]"
      >
        {durum ? <input type="hidden" name="durum" value={durum} /> : null}
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            name="q"
            defaultValue={query}
            aria-label="Anahtar ara"
            placeholder="Portföy kodu, başlık, etiket veya kişi ara…"
            className="w-full rounded-[11px] border border-line bg-canvas py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-brand-400 focus:bg-surface"
          />
        </div>
        <label className="text-xs font-semibold text-text-muted">
          <span className="sr-only">Danışman</span>
          <select
            name="danisman"
            defaultValue={danisman}
            className="rounded-[11px] border border-line bg-canvas px-3 py-2.5 text-sm font-semibold outline-none focus:border-brand-400"
          >
            <option value="">Tüm danışmanlar</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name ?? "İsimsiz"}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="focus-ring press rounded-[10px] bg-ink-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-ink-800"
        >
          Filtrele
        </button>
      </form>

      {baseTotal === 0 && !hasFilter ? (
        <EmptyState
          icon={KeyRound}
          title="Henüz anahtar kaydı yok"
          description="Anahtarlar portföy detayındaki “Anahtar takibi” bölümünden eklenir. Ekledikçe kimde olduğu, iade vadesi ve gecikmeler burada toplanır."
          tone="brand"
          action={{ href: "/app/portfoyler", label: "Portföylere git" }}
        />
      ) : (
        <div className="overflow-hidden rounded-[20px] border border-line bg-surface shadow-[var(--shadow-xs)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-display font-bold text-ink-950">Anahtarlar</h2>
              <p className="text-xs text-text-muted">
                {totalFiltered} kayıt{totalFiltered !== baseTotal ? ` · ${baseTotal} içinden` : ""}
                {totalPages > 1 ? ` · sayfa ${page}/${totalPages}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {KEY_BOARD_FILTERS.map((f) => (
                <Link
                  key={f.value || "all"}
                  href={href({ durum: f.value, sayfa: 1 })}
                  className={`focus-ring rounded-full px-2.5 py-1 text-[11px] font-bold transition ${
                    durum === f.value
                      ? "bg-ink-950 text-white"
                      : "border border-line text-text-muted hover:text-ink-950"
                  }`}
                >
                  {f.label}
                </Link>
              ))}
              {activeStaff ? (
                <Link
                  href={href({ danisman: "", sayfa: 1 })}
                  aria-label="Danışman filtresini kaldır"
                  className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600 transition hover:bg-brand-600/20"
                >
                  {activeStaff.full_name ?? "Danışman"} <X className="h-3 w-3" />
                </Link>
              ) : null}
              {query ? (
                <Link
                  href={href({ q: "", sayfa: 1 })}
                  aria-label="Aramayı temizle"
                  className="focus-ring inline-flex items-center gap-1 rounded-full bg-brand-600/10 px-2.5 py-1 text-[11px] font-bold text-brand-600 transition hover:bg-brand-600/20"
                >
                  “{query}” <X className="h-3 w-3" />
                </Link>
              ) : null}
            </div>
          </div>

          {totalFiltered === 0 ? (
            <div className="grid place-items-center px-6 py-14 text-center">
              <KeyRound className="h-8 w-8 text-text-faint" />
              <p className="mt-3 text-sm font-semibold text-ink-950">
                {durum === "gecikmis"
                  ? "Geciken anahtar iadesi yok — tebrikler"
                  : "Bu filtreyle eşleşen anahtar yok"}
              </p>
              <p className="mt-1 max-w-sm text-xs text-text-muted">
                {durum === "gecikmis"
                  ? "Vadesi geçmiş ve hâlâ dışarıda olan anahtar bulunmuyor."
                  : "Arama veya filtre kriterlerinizi değiştirip tekrar deneyin."}
              </p>
              {hasFilter ? (
                <Link
                  href="/app/portfoyler/anahtarlar"
                  className="mt-3 text-sm font-semibold text-brand-600 hover:underline"
                >
                  Filtreyi temizle
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="divide-y divide-line">
              {pageRows.map((row) => {
                const property = one(row.property);
                const staffName = one(row.holder)?.full_name ?? null;
                const overdueDays = keyOverdueDays(row, nowMs);
                const holder = keyHolderLabel({
                  status: row.status,
                  staffName,
                  holder_name: row.holder_name,
                });
                return (
                  <article
                    key={row.id}
                    className={`grid gap-3 px-5 py-4 transition hover:bg-brand-600/[0.02] lg:grid-cols-[1.3fr_.9fr_.9fr_.9fr_auto] lg:items-center ${
                      overdueDays > 0 ? "bg-danger-500/[0.03]" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      {property ? (
                        <Link href={`/app/portfoyler/${property.id}#anahtarlar`} className="focus-ring group/prop block">
                          <p className="truncate text-sm font-semibold text-ink-950 transition group-hover/prop:text-brand-600">
                            {property.title ?? "İsimsiz portföy"}
                            <ArrowUpRight className="ml-1 inline h-3 w-3 text-text-faint opacity-0 transition group-hover/prop:text-brand-600 group-hover/prop:opacity-100" />
                          </p>
                          <p className="mt-0.5 text-xs text-text-muted">{property.property_code}</p>
                        </Link>
                      ) : (
                        <p className="text-sm font-semibold text-text-muted">Portföy bulunamadı</p>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-ink-950">
                        <KeyRound className="h-3.5 w-3.5 shrink-0 text-text-faint" />
                        {row.label}
                      </p>
                      {row.key_code ? (
                        <p className="mt-0.5 text-[11px] text-text-faint">#{row.key_code}</p>
                      ) : null}
                    </div>

                    <div>
                      <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-bold ${keyStatusTone(row.status)}`}>
                        {keyStatusLabel(row.status)}
                      </span>
                      {overdueDays > 0 ? (
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-danger-600">
                          <AlertTriangle className="h-3 w-3" /> {overdueDays} gün gecikmiş
                        </p>
                      ) : null}
                    </div>

                    <div className="min-w-0 text-xs text-text-muted">
                      <p className="flex items-center gap-1.5 truncate">
                        <UserRound className="h-3.5 w-3.5 shrink-0" /> {holder}
                      </p>
                      {isKeyOut(row.status) ? (
                        <p className={`mt-0.5 ${overdueDays > 0 ? "font-semibold text-danger-600" : ""}`}>
                          {shortDate(row.taken_at)} → {row.due_at ? shortDate(row.due_at) : "süresiz"}
                        </p>
                      ) : row.returned_at ? (
                        <p className="mt-0.5">Son iade: {shortDate(row.returned_at)}</p>
                      ) : null}
                    </div>

                    <div className="flex items-center justify-end">
                      {isKeyOut(row.status) ? (
                        <form action={returnPropertyKey}>
                          <input type="hidden" name="key_id" value={row.id} />
                          <button
                            type="submit"
                            className="focus-ring press inline-flex items-center gap-1.5 rounded-[9px] bg-mint-500/12 px-3 py-2 text-xs font-semibold text-mint-700 transition hover:bg-mint-500/20"
                          >
                            <Undo2 className="h-3.5 w-3.5" /> İade al
                          </button>
                        </form>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {totalPages > 1 ? (
            <nav aria-label="Sayfalama" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
              {page > 1 ? (
                <Link
                  href={href({ sayfa: page - 1 })}
                  className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                >
                  ← Önceki
                </Link>
              ) : (
                <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">
                  ← Önceki
                </span>
              )}
              <span className="text-xs tabular-nums text-text-muted">
                Sayfa {page} / {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={href({ sayfa: page + 1 })}
                  className="focus-ring press rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-muted transition hover:border-brand-300 hover:text-brand-600"
                >
                  Sonraki →
                </Link>
              ) : (
                <span className="rounded-[9px] border border-line px-3 py-1.5 text-xs font-semibold text-text-faint opacity-50">
                  Sonraki →
                </span>
              )}
            </nav>
          ) : null}
        </div>
      )}
    </div>
  );
}
