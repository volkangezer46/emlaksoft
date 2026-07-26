import Link from "next/link";
import {
  ArrowUpRight,
  Building2,
  Crosshair,
  Sparkles,
  Target,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  fetchTenantMatchingWeights,
  MATCHING_WEIGHT_KEYS,
  MATCHING_WEIGHT_LABELS,
  matchingWeightsPercent,
  scoreDemandProperty,
  tierCls,
  tierLabel,
  tierOf,
  type MatchDemand,
  type MatchingWeights,
  type MatchProperty,
} from "@/lib/matching";
import { moneyTry } from "@/lib/leak-shield";
import { requireModulePage } from "@/lib/require-module-page";
import { SaveMatchButton } from "./save-match-button";
import type { CSSProperties } from "react";

const RING_C = 2 * Math.PI * 42;

type DemandRow = MatchDemand & {
  customer: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
};

function customerOf(d: DemandRow) {
  return Array.isArray(d.customer) ? d.customer[0] : d.customer;
}

function budgetLabel(min: number | null, max: number | null) {
  if (min != null && max != null) return `${moneyTry(min)} – ${moneyTry(max)}`;
  if (max != null) return `≤ ${moneyTry(max)}`;
  if (min != null) return `≥ ${moneyTry(min)}`;
  return "Bütçe yok";
}

export default async function MatchingPage({
  searchParams,
}: {
  searchParams: Promise<{ demand?: string; property?: string; customer?: string; kademe?: string; minSkor?: string; sayfa?: string }>;
}) {
  await requireModulePage("matching");
  const sp = await searchParams;
  const supabase = await createClient();

  // Bellek-içi skor filtreleri: ?kademe=guclu|iyi veya ?minSkor=<sayı>
  const kademeF = sp.kademe === "guclu" ? "strong" : sp.kademe === "iyi" ? "good" : null;
  const minSkorParsed = Number.parseInt(sp.minSkor ?? "", 10);
  const minSkorF = Number.isFinite(minSkorParsed) && minSkorParsed > 0 ? minSkorParsed : null;

  // Skor filtresi linkleri mevcut varlık filtrelerini (customer/demand/property) korur.
  // Filtre değişiminde sayfa 1'e döner: patch.sayfa verilmedikçe ?sayfa= yazılmaz.
  const matchHref = (patch: { kademe?: string | null; minSkor?: string | null; sayfa?: number | null }) => {
    const q = new URLSearchParams();
    if (sp.customer) q.set("customer", sp.customer);
    if (sp.demand) q.set("demand", sp.demand);
    if (sp.property) q.set("property", sp.property);
    const kademe = patch.kademe !== undefined ? patch.kademe : sp.kademe;
    const minSkor = patch.minSkor !== undefined ? patch.minSkor : sp.minSkor;
    if (kademe) q.set("kademe", kademe);
    if (minSkor) q.set("minSkor", minSkor);
    if (patch.sayfa != null && patch.sayfa > 1) q.set("sayfa", String(patch.sayfa));
    const s = q.toString();
    return s ? `/app/eslestirme?${s}` : "/app/eslestirme";
  };

  // Ofise özel kriter ağırlıkları — null/eksik kolonda varsayılan set kullanılır.
  const tenantWeights: MatchingWeights | null =
    (await fetchTenantMatchingWeights(supabase)) ?? null;
  const weightPercents = matchingWeightsPercent(tenantWeights ?? undefined);

  const { data: demandsData } = await supabase
    .from("customer_demands")
    .select(
      "id, transaction_type, property_type, province_id, district_id, budget_min, budget_max, rooms, min_sqm, urgency, status, customer:customers(id, full_name)",
    )
    .neq("status", "closed")
    .order("created_at", { ascending: false })
    .limit(80);

  let demands = (demandsData ?? []) as DemandRow[];

  if (sp.customer) {
    demands = demands.filter((d) => customerOf(d)?.id === sp.customer);
  }
  if (sp.demand) {
    demands = demands.filter((d) => d.id === sp.demand);
  }

  // ── SQL ön filtre ─────────────────────────────────────────────────────────
  // Eskiden 80 talep × 120 portföy bellekte çapraz skorlanıyordu. Artık
  // portföyler taleplerin il ve işlem türü kümesine göre TEK sorguda (.in())
  // daraltılır; skor yine bellekte ama aday kümesi küçük.
  //
  // İşlem türü serbest metin ("Satılık", "satilik", "sale"...): talep
  // gruplarına (satış/kira) karşılık gelen yaygın varyantlar listeye açılır,
  // tanınmayan değerler olduğu gibi eklenir. Uyumsuz işlem türü skoru zaten
  // 20'ye sabitlediği (eşik 35) için bu daraltma sonuç kaybetmez.
  const SALE_VARIANTS = ["Satılık", "satılık", "Satilik", "satilik", "SATILIK", "sale", "Sale", "Satış", "satış", "Satis", "satis"];
  const RENT_VARIANTS = ["Kiralık", "kiralık", "Kiralik", "kiralik", "KİRALIK", "rent", "Rent", "Kira", "kira"];
  const isSaleTx = (v: string) => ["satılık", "satilik", "sale", "satış", "satis"].some((x) => v.includes(x));
  const isRentTx = (v: string) => ["kiralık", "kiralik", "rent", "kira"].some((x) => v.includes(x));

  const txVariants = new Set<string>();
  let txFilterable = demands.length > 0;
  for (const d of demands) {
    const raw = (d.transaction_type ?? "").trim();
    const n = raw.toLocaleLowerCase("tr-TR");
    if (!n) {
      // İşlem türü boş talep her portföyle uyumlu sayılır → tür filtresi kapanır.
      txFilterable = false;
      break;
    }
    if (isSaleTx(n)) SALE_VARIANTS.forEach((v) => txVariants.add(v));
    else if (isRentTx(n)) RENT_VARIANTS.forEach((v) => txVariants.add(v));
    txVariants.add(raw);
  }

  const provinceIds = [...new Set(demands.map((d) => d.province_id).filter((x): x is string => x != null))];
  // İli belirsiz talep varsa il filtresi uygulanamaz (her il uyumlu olabilir).
  const provinceFilterable = demands.length > 0 && demands.every((d) => d.province_id != null) && provinceIds.length > 0;

  let propQuery = supabase
    .from("properties")
    .select(
      "id, property_code, title, transaction_type, property_type, status, list_price, province_id, district_id, features",
    )
    .is("deleted_at", null)
    .in("status", ["live", "draft", "reserved", "Yayında"]);
  if (sp.property) propQuery = propQuery.eq("id", sp.property);
  if (txFilterable && txVariants.size > 0) propQuery = propQuery.in("transaction_type", [...txVariants]);
  // İli null portföy "İl (belirsiz)" olarak yine skorlanır — dışarıda bırakma.
  if (provinceFilterable) propQuery = propQuery.or(`province_id.is.null,province_id.in.(${provinceIds.join(",")})`);

  const { data: propertiesData } = await propQuery.order("created_at", { ascending: false }).limit(200);

  const properties = (propertiesData ?? []).map((p) => ({
    ...p,
    list_price: p.list_price != null ? Number(p.list_price) : null,
    features: (p.features ?? {}) as MatchProperty["features"],
  })) as MatchProperty[];

  // ── Geri bildirimden öğrenme (v1) ─────────────────────────────────────────
  // Portal geri bildirimi TEK toplu sorguyla çekilir (sayfadaki müşteri
  // id'leri ile .in()). disliked (müşteri, portföy) çifti listeden çıkarılır,
  // liked çifti +10 bonus ve 💚 rozeti alır.
  const feedbackCustomerIds = [
    ...new Set(demands.map((d) => customerOf(d)?.id).filter((x): x is string => x != null)),
  ];
  const { data: feedbackData } = feedbackCustomerIds.length
    ? await supabase
        .from("portal_match_feedback")
        .select("customer_id, property_id, verdict")
        .in("customer_id", feedbackCustomerIds)
    : { data: [] as { customer_id: string; property_id: string; verdict: string }[] };

  const likedPairs = new Set<string>();
  const dislikedPairs = new Set<string>();
  for (const fb of feedbackData ?? []) {
    const key = `${fb.customer_id}:${fb.property_id}`;
    if (fb.verdict === "liked") likedPairs.add(key);
    else if (fb.verdict === "disliked") dislikedPairs.add(key);
  }

  type Pair = {
    demand: DemandRow;
    property: MatchProperty;
    score: number;
    tier: ReturnType<typeof scoreDemandProperty>["tier"];
    reasons: ReturnType<typeof scoreDemandProperty>["reasons"];
    likedByCustomer: boolean;
  };

  const pairs: Pair[] = [];
  let hiddenByFeedback = 0;
  for (const demand of demands) {
    const customerId = customerOf(demand)?.id ?? null;
    for (const property of properties) {
      const fbKey = customerId ? `${customerId}:${property.id}` : null;
      const result = scoreDemandProperty(demand, property, tenantWeights);
      if (fbKey && dislikedPairs.has(fbKey)) {
        // "Müşteri ilgilenmedi" — listede görünecek skordaysa gizlenen sayısına yaz.
        if (result.score >= 35) hiddenByFeedback += 1;
        continue;
      }
      const likedByCustomer = fbKey != null && likedPairs.has(fbKey);
      const score = likedByCustomer ? Math.min(100, result.score + 10) : result.score;
      if (score < 35) continue;
      pairs.push({
        demand,
        property,
        score,
        tier: likedByCustomer ? tierOf(score) : result.tier,
        reasons: result.reasons,
        likedByCustomer,
      });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  // Hero istatistikleri ve skor dağılımı TAM kümeden; liste skor filtresinden.
  let filteredPairs = pairs;
  if (kademeF) filteredPairs = filteredPairs.filter((p) => p.tier === kademeF);
  if (minSkorF != null) filteredPairs = filteredPairs.filter((p) => p.score >= minSkorF);

  // Sayfalama: ?sayfa= — 30 eşleşme/sayfa. Filtre linkleri sayfayı sıfırlar.
  const PAGE_SIZE = 30;
  const totalPages = Math.max(1, Math.ceil(filteredPairs.length / PAGE_SIZE));
  const sayfaParsed = Number.parseInt(sp.sayfa ?? "", 10);
  const page = Math.min(Number.isFinite(sayfaParsed) && sayfaParsed > 0 ? sayfaParsed : 1, totalPages);
  const top = filteredPairs.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const strong = pairs.filter((p) => p.tier === "strong").length;
  const good = pairs.filter((p) => p.tier === "good").length;
  const avg = pairs.length ? Math.round(pairs.reduce((s, p) => s + p.score, 0) / pairs.length) : 0;
  const hitRate = demands.length && properties.length
    ? Math.min(1, pairs.length / Math.max(1, demands.length))
    : 0;

  const scoreBuckets = [0, 0, 0, 0]; // 35-54, 55-74, 75-89, 90+
  pairs.forEach((p) => {
    if (p.score >= 90) scoreBuckets[3] += 1;
    else if (p.score >= 75) scoreBuckets[2] += 1;
    else if (p.score >= 55) scoreBuckets[1] += 1;
    else scoreBuckets[0] += 1;
  });
  const maxBucket = Math.max(1, ...scoreBuckets);

  return (
    <div className="space-y-6">
      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-56 w-56 rounded-full bg-cyan-400/20 blur-[90px]" />
        <div className="relative grid gap-6 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <span className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
              <Crosshair className="h-4 w-4" /> Talep × Portföy eşleştirme
            </span>
            <h1 className="mt-2 font-display text-2xl font-extrabold text-white md:text-3xl">Akıllı eşleşme motoru</h1>
            <p className="mt-1 max-w-lg text-sm text-white/60">
              Müşteri taleplerini portföylerle bütçe, konum, oda ve işlem türüne göre skorlar. Scraping yok — kendi veriniz.
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {/* Güçlü/iyi kutuları öneri listesini ?kademe= ile daraltır;
                  aktifken tekrar tıklamak filtreyi kaldırır. */}
              {[
                { label: "Açık talep", value: demands.length, cls: "", href: "/app/talepler" },
                { label: "Portföy", value: properties.length, cls: "", href: "/app/portfoyler" },
                { label: "Güçlü eşleşme", value: strong, cls: "text-mint-400", href: matchHref({ kademe: kademeF === "strong" ? null : "guclu", minSkor: null }) },
                { label: "İyi eşleşme", value: good, cls: "text-cyan-300", href: matchHref({ kademe: kademeF === "good" ? null : "iyi", minSkor: null }) },
              ].map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 p-3 transition hover:border-brand-300"
                >
                  <p className={`flex items-start justify-between font-display text-xl font-extrabold ${item.cls}`}>
                    {item.value}
                    <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                  </p>
                  <p className="text-[11px] text-white/45">{item.label}</p>
                </Link>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-5 rounded-[16px] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="relative grid h-28 w-28 place-items-center">
              <div
                className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-25 blur-md"
                style={{ background: "conic-gradient(from 0deg, var(--cyan-400), var(--mint-400), var(--cyan-400))" }}
              />
              <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  stroke="var(--cyan-400)"
                  strokeWidth="8"
                  strokeLinecap="round"
                  className="ring-sweep"
                  style={{ "--circ": RING_C, "--dash": RING_C * (1 - hitRate) } as CSSProperties}
                />
              </svg>
              <div className="absolute text-center">
                <p className="font-display text-xl font-extrabold">{avg || 0}</p>
                <p className="text-[10px] text-white/45">ort. skor</p>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white/45">Skor dağılımı</p>
              <div className="mt-3 flex h-20 items-end gap-2">
                {/* Her çubuk ?minSkor= filtresine iner; aktif çubuk tekrar tıklanınca temizler. */}
                {[
                  { label: "35–54", min: 35 },
                  { label: "55–74", min: 55 },
                  { label: "75–89", min: 75 },
                  { label: "90+", min: 90 },
                ].map((b, i) => {
                  const active = minSkorF === b.min;
                  return (
                    <Link
                      key={b.label}
                      href={matchHref({ minSkor: active ? null : String(b.min), kademe: null })}
                      title={`Skor ≥ ${b.min} önerilerini listele`}
                      className={`focus-ring group flex flex-1 flex-col items-center gap-1 rounded-[6px] transition ${active ? "bg-white/10" : "hover:bg-white/5"}`}
                    >
                      <span className="text-[10px] font-bold text-white/80">{scoreBuckets[i]}</span>
                      <div
                        className="bar-live w-full max-w-[28px] rounded-t-[4px] bg-gradient-to-t from-cyan-500 to-mint-400 transition group-hover:from-cyan-400 group-hover:to-mint-300"
                        style={{ height: `${Math.max((scoreBuckets[i] / maxBucket) * 100, 8)}%`, animationDelay: `${i * 0.08}s` }}
                      />
                      <span className="text-[8px] text-white/35">{b.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Aktif ağırlık seti — şeffaflık satırı + Ayarlar bağlantısı */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[12px] border border-line bg-surface px-4 py-2.5 text-xs text-text-muted">
        <span className="font-bold text-ink-950">Ağırlıklar:</span>
        <span>
          {MATCHING_WEIGHT_KEYS.map((k) => `${MATCHING_WEIGHT_LABELS[k]} %${weightPercents[k]}`).join(" · ")}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tenantWeights ? "bg-cyan-400/12 text-cyan-600" : "bg-ink-950/8 text-text-muted"}`}>
          {tenantWeights ? "ofise özel" : "varsayılan"}
        </span>
        <Link
          href="/app/ayarlar#eslestirme-agirliklari"
          className="ml-auto inline-flex items-center gap-1 font-semibold text-brand-600"
        >
          Ayarlar <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {(sp.customer || sp.demand || sp.property || kademeF || minSkorF != null) ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-cyan-400/30 bg-cyan-400/8 px-4 py-3 text-sm text-ink-950">
          <Sparkles className="h-4 w-4 text-cyan-600" />
          Filtre aktif
          {sp.customer ? <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold">müşteri</span> : null}
          {sp.demand ? <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold">talep</span> : null}
          {sp.property ? <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold">portföy</span> : null}
          {kademeF ? (
            <Link href={matchHref({ kademe: null })} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold hover:text-brand-600" title="Kademe filtresini kaldır">
              {kademeF === "strong" ? "güçlü eşleşme" : "iyi eşleşme"} ✕
            </Link>
          ) : null}
          {minSkorF != null ? (
            <Link href={matchHref({ minSkor: null })} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold hover:text-brand-600" title="Skor filtresini kaldır">
              skor ≥ {minSkorF} ✕
            </Link>
          ) : null}
          <Link href="/app/eslestirme" className="ml-auto text-xs font-semibold text-brand-600">Filtreyi temizle</Link>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Target className="h-4 w-4 text-brand-600" /> Eşleşme önerileri
            </h2>
            <p className="text-xs text-text-muted">
              {filteredPairs.length} öneri · skor ≥ {minSkorF ?? 35}
              {kademeF ? ` · ${kademeF === "strong" ? "güçlü" : "iyi"} kademe` : ""}
              {totalPages > 1 ? ` · sayfa ${page}/${totalPages}` : ""}
            </p>
            {hiddenByFeedback > 0 ? (
              <p className="mt-0.5 text-xs text-amber-600">
                {hiddenByFeedback} eşleşme müşteri geri bildirimiyle gizlendi (&quot;müşteri ilgilenmedi&quot;).
              </p>
            ) : null}
          </div>
        </div>

        {top.length === 0 ? (
          pairs.length > 0 ? (
            /* Eşleşme var ama skor filtresi hepsini eledi — "hiç yok" deme */
            <div className="grid place-items-center px-6 py-14 text-center">
              <Crosshair className="h-8 w-8 text-text-faint" />
              <p className="mt-3 font-display font-bold text-ink-950">Filtreye uyan eşleşme yok</p>
              <p className="mt-1 max-w-md text-sm text-text-muted">
                {pairs.length} öneri skor/kademe filtresine takıldı.
              </p>
              <Link
                href={matchHref({ kademe: null, minSkor: null })}
                className="mt-4 rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Skor filtresini temizle
              </Link>
            </div>
          ) : (
          <div className="grid place-items-center px-6 py-14 text-center">
            <Crosshair className="h-8 w-8 text-text-faint" />
            <p className="mt-3 font-display font-bold text-ink-950">Henüz eşleşme yok</p>
            <p className="mt-1 max-w-md text-sm text-text-muted">
              Açık talep ve yayında portföy ekleyin. Bütçe / il / oda örtüşünce burada skorlanır.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href="/app/musteriler" className="rounded-[10px] bg-brand-600 px-4 py-2 text-sm font-semibold text-white">Müşteriler</Link>
              <Link href="/app/portfoyler" className="rounded-[10px] border border-line px-4 py-2 text-sm font-semibold text-ink-950">Portföyler</Link>
            </div>
          </div>
          )
        ) : (
          <div className="divide-y divide-line">
            {top.map((pair) => {
              const customer = customerOf(pair.demand);
              return (
                <article
                  key={`${pair.demand.id}-${pair.property.id}`}
                  className="grid gap-4 px-5 py-4 transition hover:bg-brand-600/[0.02] lg:grid-cols-[1.1fr_1.1fr_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-brand-600">
                      <Users className="h-3 w-3" /> Talep
                    </p>
                    <Link
                      href={customer ? `/app/musteriler/${customer.id}` : "/app/musteriler"}
                      className="mt-1 block truncate font-display text-base font-bold text-ink-950 hover:text-brand-600"
                    >
                      {customer?.full_name ?? "Müşteri"}
                    </Link>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {pair.demand.transaction_type}
                      {pair.demand.property_type ? ` · ${pair.demand.property_type}` : ""}
                      {pair.demand.rooms ? ` · ${pair.demand.rooms}` : ""}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-ink-950">
                      {budgetLabel(
                        pair.demand.budget_min != null ? Number(pair.demand.budget_min) : null,
                        pair.demand.budget_max != null ? Number(pair.demand.budget_max) : null,
                      )}
                    </p>
                  </div>

                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-mint-600">
                      <Building2 className="h-3 w-3" /> Portföy
                    </p>
                    <Link
                      href={`/app/portfoyler/${pair.property.id}`}
                      className="mt-1 block truncate font-display text-base font-bold text-ink-950 hover:text-brand-600"
                    >
                      {pair.property.title ?? pair.property.property_code}
                    </Link>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {pair.property.property_code} · {pair.property.transaction_type} · {pair.property.property_type}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-ink-950">
                      {pair.property.list_price != null ? moneyTry(pair.property.list_price) : "Fiyat yok"}
                    </p>
                  </div>

                  <div className="flex flex-col items-start gap-2 lg:items-end">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-2xl font-extrabold text-ink-950">{pair.score}</span>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${tierCls(pair.tier)}`}>
                        {tierLabel(pair.tier)}
                      </span>
                      {pair.likedByCustomer ? (
                        <span
                          className="rounded-full bg-mint-500/12 px-2.5 py-1 text-[11px] font-bold text-mint-600"
                          title="Müşteri portalında bu portföyü beğendi — skora +10 eklendi"
                        >
                          💚 Müşteri beğendi
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-1 lg:justify-end">
                      {pair.reasons.filter((r) => r.ok).slice(0, 4).map((r) => (
                        <span key={r.label} className="rounded-full bg-mint-500/10 px-2 py-0.5 text-[10px] font-semibold text-mint-600">
                          {r.label}
                        </span>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      <SaveMatchButton demandId={pair.demand.id} propertyId={pair.property.id} />
                      <Link
                        href={`/app/portfoyler/${pair.property.id}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600"
                      >
                        Portföyü aç <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {totalPages > 1 ? (
          <div className="flex items-center justify-between border-t border-line px-5 py-3">
            {page > 1 ? (
              <Link
                href={matchHref({ sayfa: page - 1 })}
                className="focus-ring press rounded-[10px] border border-line bg-canvas px-3.5 py-2 text-xs font-semibold text-ink-950 transition hover:border-brand-300"
              >
                ← Önceki
              </Link>
            ) : (
              <span className="rounded-[10px] border border-line px-3.5 py-2 text-xs font-semibold text-text-faint">← Önceki</span>
            )}
            <span className="text-xs font-semibold text-text-muted">
              Sayfa {page} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={matchHref({ sayfa: page + 1 })}
                className="focus-ring press rounded-[10px] border border-line bg-canvas px-3.5 py-2 text-xs font-semibold text-ink-950 transition hover:border-brand-300"
              >
                Sonraki →
              </Link>
            ) : (
              <span className="rounded-[10px] border border-line px-3.5 py-2 text-xs font-semibold text-text-faint">Sonraki →</span>
            )}
          </div>
        ) : null}
      </section>
    </div>
  );
}
