import Link from "@/components/ui/smart-link";
import { prefillHref } from "@/lib/prefill-params";
import {
  ArrowUpRight,
  Building2,
  CalendarPlus,
  Crosshair,
  Presentation,
  Sparkles,
  Tag,
  Target,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  explainMatch,
  fetchTenantMatchingWeights,
  MATCHING_WEIGHT_KEYS,
  MATCHING_WEIGHT_LABELS,
  matchingWeightsPercent,
  tierCls,
  tierLabel,
  type MatchDemand,
  type MatchingWeights,
} from "@/lib/matching";
import { moneyTry } from "@/lib/leak-shield";
import { requireModulePage } from "@/lib/require-module-page";
import { decodeDemandPreviewParam, parseDemandValues } from "@/lib/demand-criteria";
import { loadDemandMatches, MATCH_CANDIDATE_LIMIT, MATCH_SHOW_MIN } from "@/lib/match-candidates";
import { wasSent } from "@/lib/match-state";
import { now as clockNow } from "@/lib/clock";
import { MatchDismissButton } from "./match-dismiss-button";
import { MatchStateBadge } from "./match-state-badge";
import { SaveMatchButton } from "./save-match-button";
import { SendMatchButton } from "./send-match-button";
import { BulkSendMatches } from "./bulk-send-matches";
import { MatchSelectCheckbox, MatchSelectionBar, MatchSelectionProvider } from "./match-selection";
import { Fragment } from "react";
import { RadialGauge } from "@/components/ui/viz";

import { PageHeader } from "@/components/ui/page-header";
import { HelpTip } from "@/components/ui/help-tip";
import { scopeLabel } from "@/lib/metric-labels";
/** ?kriter= önizleme bağlantısının sanal talep kimliği (kayıtlı talep değildir). */
const PREVIEW_DEMAND_ID = "onizleme";

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Eşleşme sekmesi. HIZ (Müşteri → Eşleştir ilk açılışı; kök neden analizi SK7):
 *  - ESKİ: son 80 açık talep (müşteriden bağımsız) çekilip ?customer= BELLEKTE süzülüyordu; müşterinin talebi ilk 80'de
 *    değilse liste boş kalıyordu. Ağırlık+talep → aday portföy → geri bildirim üç SIRALI tur; sayfa tüm hesap bitene kadar
 *    hiç çizilmiyordu.
 *  - YENİ: ?customer= / ?demand= süzgeci SORGUDA; müşteri biliniyorsa geri bildirim ilk turla paralel. Aday kümesi sınırlı
 *    (MATCH_CANDIDATE_LIMIT, il/işlem türüyle daraltılmış); sayfa sekmeleri hemen çizer, bu görünüm Suspense içinde akar.
 */
export async function MatchingView({
  searchParams,
  canCreateOffer = false,
}: {
  searchParams: Promise<{ demand?: string; property?: string; customer?: string; kademe?: string; minSkor?: string; sayfa?: string; kriter?: string; gizlenen?: string }>;
  /** `offers:create` (sunucuda hesaplanır, sözleşme k): yoksa "Teklif al" kısayolu çizilmez. */
  canCreateOffer?: boolean;
}) {
  const [, sp, supabase] = await Promise.all([requireModulePage("matching"), searchParams, createClient()]);
  const customerF = sp.customer && UUID_RE.test(sp.customer) ? sp.customer : null;
  const demandF = sp.demand && UUID_RE.test(sp.demand) ? sp.demand : null;

  // Bellek-içi skor filtreleri: ?kademe=guclu|iyi veya ?minSkor=<sayı>
  const kademeF = sp.kademe === "guclu" ? "strong" : sp.kademe === "iyi" ? "good" : null;
  const minSkorParsed = Number.parseInt(sp.minSkor ?? "", 10);
  const minSkorF = Number.isFinite(minSkorParsed) && minSkorParsed > 0 ? minSkorParsed : null;

  // Skor filtresi linkleri mevcut varlık filtrelerini (customer/demand/property) korur.
  // Filtre değişiminde sayfa 1'e döner: patch.sayfa verilmedikçe ?sayfa= yazılmaz.
  const matchHref = (patch: { kademe?: string | null; minSkor?: string | null; sayfa?: number | null; gizlenen?: boolean }) => {
    const q = new URLSearchParams();
    if (sp.customer) q.set("customer", sp.customer);
    if (sp.demand) q.set("demand", sp.demand);
    if (sp.property) q.set("property", sp.property);
    if (sp.kriter) q.set("kriter", sp.kriter);
    const kademe = patch.kademe !== undefined ? patch.kademe : sp.kademe;
    const minSkor = patch.minSkor !== undefined ? patch.minSkor : sp.minSkor;
    if (kademe) q.set("kademe", kademe);
    if (minSkor) q.set("minSkor", minSkor);
    const gizlenen = patch.gizlenen !== undefined ? patch.gizlenen : sp.gizlenen === "1";
    if (gizlenen) q.set("gizlenen", "1");
    if (patch.sayfa != null && patch.sayfa > 1) q.set("sayfa", String(patch.sayfa));
    const s = q.toString();
    return s ? `/app/talepler?sekme=eslesme&${s}` : "/app/talepler?sekme=eslesme";
  };

  // Ofise özel kriter ağırlıkları — null/eksik kolonda varsayılan set kullanılır.
  const tenantWeightsPromise = fetchTenantMatchingWeights(supabase);

  // Form içi canlı önizleme bağlantısı (?kriter=): henüz kaydedilmemiş talebi tek sanal talep
  // olarak skorlar (formdaki sayıyla AYNI parse + skor + aday sorgusu). Kayıt yazılmaz.
  const previewValues = decodeDemandPreviewParam(sp.kriter);
  const previewParsed = previewValues ? parseDemandValues(previewValues) : null;
  const previewDemand: DemandRow | null =
    previewParsed && previewParsed.ok
      ? {
          id: PREVIEW_DEMAND_ID,
          ...previewParsed.columns,
          property_type: previewParsed.columns.property_type,
          status: "active",
          criteria: previewParsed.criteria,
          customer: null,
        }
      : null;

  // Talep sorgusu ağırlıklarla AYNI turda; ?customer= / ?demand= süzgeci SORGUDA (eskiden son 80 talep bellekte süzülüyordu).
  let demandsQuery = supabase
    .from("customer_demands")
    .select(
      "id, transaction_type, property_type, province_id, district_id, neighborhood_id, budget_min, budget_max, rooms, min_sqm, urgency, status, criteria, customer:customers!customer_demands_customer_id_fkey(id, full_name)",
    )
    .neq("status", "closed");
  if (customerF) demandsQuery = demandsQuery.eq("customer_id", customerF);
  if (demandF) demandsQuery = demandsQuery.eq("id", demandF);
  const demandsPromise = previewDemand
    ? Promise.resolve({ data: [] as DemandRow[] })
    : demandsQuery.order("created_at", { ascending: false }).limit(80);
  const [tenantWeightsRaw, { data: demandsData }] = await Promise.all([tenantWeightsPromise, demandsPromise]);
  const tenantWeights: MatchingWeights | null = tenantWeightsRaw ?? null;
  const weightPercents = matchingWeightsPercent(tenantWeights ?? undefined);

  let demands = previewDemand ? [previewDemand] : ((demandsData ?? []) as unknown as DemandRow[]);
  // Biçimsiz kimlik (UUID değil) sorguya girmez; davranış eskisi gibi boş kümedir.
  if (!previewDemand && sp.customer && !customerF) demands = [];
  if (!previewDemand && sp.demand && !demandF) demands = [];

  // ── TEK eşleşme okuyucusu (src/lib/match-candidates.ts): aday portföyler + müşteri geri bildirimi + eşleşme durumu
  // (CRM-G4) TEK turda; skor kuralı talep detayı ve Müşteri 360 ile AYNI. Müşteri "beğenmedi" / danışman "uygun değil"
  // çiftleri gizlenir (?gizlenen=1 ile rozetli geri gelir), beğenilen +10 ve 💚 rozeti alır.
  const showHidden = sp.gizlenen === "1";
  const candidates = await loadDemandMatches(supabase, {
    demands,
    customerOf: (d) => customerOf(d)?.id ?? null,
    propertyId: sp.property ?? null,
    includeHidden: showHidden,
    weights: tenantWeights,
    withState: !previewDemand,
  });
  const properties = candidates.properties;
  const pairs = candidates.pairs;
  const hiddenByFeedback = candidates.hiddenByFeedback;
  const hiddenDismissed = candidates.hiddenDismissed;
  const nowMs = clockNow();
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
  // İstatistikler gizlenen çiftleri saymaz (?gizlenen=1 yalnız listeyi genişletir).
  const visiblePairs = pairs.filter((p) => p.hiddenBy == null);
  const strong = visiblePairs.filter((p) => p.tier === "strong").length;
  const good = visiblePairs.filter((p) => p.tier === "good").length;
  const avg = visiblePairs.length ? Math.round(visiblePairs.reduce((s, p) => s + p.score, 0) / visiblePairs.length) : 0;
  const hitRate = demands.length && properties.length
    ? Math.min(1, visiblePairs.length / Math.max(1, demands.length))
    : 0;

  const scoreBuckets = [0, 0, 0, 0]; // 35-54, 55-74, 75-89, 90+
  visiblePairs.forEach((p) => {
    if (p.score >= 90) scoreBuckets[3] += 1;
    else if (p.score >= 75) scoreBuckets[2] += 1;
    else if (p.score >= 55) scoreBuckets[1] += 1;
    else scoreBuckets[0] += 1;
  });
  const maxBucket = Math.max(1, ...scoreBuckets);

  // Tek portföye süzülü (?property=): "Tümüne gönder" — ör. fiyat düşüşünde eşleşen tüm alıcılara aynı mesaj (skor
  // filtresine uyan, kayıtlı talepler; sıra skor sırası). İzin/engel/telefon kontrolü sunucuda (matching-bulk).
  const propertyF = sp.property && UUID_RE.test(sp.property) ? sp.property : null;
  // Gizlenen çiftler (uygun değil / beğenmedi) toplu gönderime girmez; daha önce gönderilenler sunucuda varsayılan hariç.
  const bulkPairs =
    propertyF && !previewDemand
      ? filteredPairs.filter((p) => p.property.id === propertyF && p.hiddenBy == null)
      : [];
  const bulkDemandIds = [...new Set(bulkPairs.map((p) => p.demand.id))];
  const bulkSentCount = new Set(bulkPairs.filter((p) => wasSent(p.state)).map((p) => p.demand.id)).size;
  // Tek müşteriye süzülü (?customer= / ?demand=): satır seçimiyle çoklu sunum (?portfoy=a,b,c&musteri=).
  const selectionCustomerId =
    previewDemand || propertyF ? null : customerF ?? (demandF && demands.length === 1 ? customerOf(demands[0])?.id ?? null : null);
  const SelectionWrap = selectionCustomerId ? MatchSelectionProvider : Fragment;

  return (
    <div className="space-y-6">
      {candidates.error ? (
        <p role="alert" className="rounded-[var(--radius-card)] border border-danger-500/40 bg-danger-500/10 px-4 py-3 text-sm text-ink-950">
          {candidates.error} Aşağıdaki boş liste &quot;eşleşme yok&quot; anlamına gelmez.
        </p>
      ) : null}
      {candidates.truncated ? (
        <p role="status" className="rounded-[var(--radius-card)] border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-ink-950">
          Aday portföy sayısı çok yüksek: yalnızca en yeni {MATCH_CANDIDATE_LIMIT} portföy taranıyor. Daha eski portföyler bu listede
          çıkmaz; talebi il/işlem türüne göre daraltın veya belirli bir portföyden başlatın.
        </p>
      ) : null}
      <PageHeader title="Müşteriye uygun ilanlar" eyebrow="Talep ve portföy eşleştirme" description={<>Müşteri taleplerini ilanlarınızla bütçe, konum, oda ve işlem türüne göre puanlar. Yalnızca kendi kayıtlarınız kullanılır. <HelpTip topic="eslestirme" /></>} />

      <section className="theme-dark grid gap-3 rounded-[var(--radius-panel)] bg-[image:var(--grad-ink)] p-3 sm:p-4 lg:grid-cols-2">
<div className="flex items-center gap-5 rounded-[var(--radius-card)] border border-white/10 bg-white/[0.04] p-4 backdrop-blur">
            <div className="relative grid h-28 w-28 place-items-center">
              <div
                className="conic-spin pointer-events-none absolute inset-2 rounded-full opacity-25 blur-md"
                style={{ background: "conic-gradient(from 0deg, var(--cyan-400), var(--mint-400), var(--cyan-400))" }}
              />
              <RadialGauge
                value={Math.round(hitRate * 100)}
                max={100}
                size={112}
                stroke={9}
                color="var(--cyan-400)"
                trackColor="var(--viz-track-inverse)"
                format="percent"
                ariaLabel="Eşleşme oranı"
                className="absolute inset-0"
              />
              <div className="absolute text-center">
                <p className="font-display text-xl font-extrabold">{avg || 0}</p>
                <p className="text-xs text-white/45">ort. skor</p>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/45">Skor dağılımı</p>
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
                      className={`focus-ring group flex flex-1 flex-col items-center gap-1 rounded-[var(--radius-control)] transition ${active ? "bg-white/10" : "hover:bg-white/5"}`}
                    >
                      <span className="text-xs font-bold text-white/80">{scoreBuckets[i]}</span>
                      <div
                        className="bar-live w-full max-w-[28px] rounded-t-[4px] bg-gradient-to-t from-cyan-500 to-mint-400 transition group-hover:from-cyan-400 group-hover:to-mint-300"
                        style={{ height: `${Math.max((scoreBuckets[i] / maxBucket) * 100, 8)}%`, animationDelay: `${i * 0.08}s` }}
                      />
                      <span className="text-xs text-white/35">{b.label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </div>
<div className="min-w-0 space-y-3"><div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {/* Güçlü/iyi kutuları öneri listesini ?kademe= ile daraltır;
                  aktifken tekrar tıklamak filtreyi kaldırır. */}
              {[
                { label: "Açık talep", value: demands.length, cls: "", href: "/app/talepler" },
                { label: `${scopeLabel("matchable")} portföy`, value: properties.length, cls: "", href: "/app/portfoyler" },
                { label: "Güçlü eşleşme", value: strong, cls: "text-mint-400", href: matchHref({ kademe: kademeF === "strong" ? null : "guclu", minSkor: null }) },
                { label: "İyi eşleşme", value: good, cls: "text-cyan-300", href: matchHref({ kademe: kademeF === "good" ? null : "iyi", minSkor: null }) },
              ].map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="focus-ring press lift group block rounded-[var(--radius-card)] border border-white/10 bg-white/5 p-3 transition hover:border-brand-300"
                >
                  <p className={`flex items-start justify-between font-display text-xl font-extrabold ${item.cls}`}>
                    {item.value}
                    <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                  </p>
                  <p className="text-xs text-white/45">{item.label}</p>
                </Link>
              ))}
            </div></div>
      </section>

      {/* Aktif ağırlık seti — şeffaflık satırı + Ayarlar bağlantısı */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-card)] border border-line bg-surface px-4 py-2.5 text-xs text-text-muted">
        <span className="font-bold text-ink-950">Ağırlıklar:</span>
        <span>
          {MATCHING_WEIGHT_KEYS.map((k) => `${MATCHING_WEIGHT_LABELS[k]} %${weightPercents[k]}`).join(" · ")}
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${tenantWeights ? "bg-cyan-400/12 text-cyan-600" : "bg-ink-950/8 text-text-muted"}`}>
          {tenantWeights ? "ofise özel" : "varsayılan"}
        </span>
        <Link
          href="/app/ayarlar?sekme=eslestirme#eslestirme-agirliklari"
          className="ml-auto inline-flex items-center gap-1 font-semibold text-brand-600"
        >
          Ayarlar <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {(sp.customer || sp.demand || sp.property || kademeF || minSkorF != null || showHidden) ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[var(--radius-card)] border border-cyan-400/30 bg-cyan-400/8 px-4 py-3 text-sm text-ink-950">
          <Sparkles className="h-4 w-4 text-cyan-600" />
          Filtre aktif
          {sp.customer ? <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold">müşteri</span> : null}
          {sp.demand ? <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold">talep</span> : null}
          {sp.property ? <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold">portföy</span> : null}
          {showHidden ? (
            <Link href={matchHref({ gizlenen: false })} className="rounded-full bg-white px-2 py-0.5 text-xs font-bold hover:text-brand-600" title="Gizlenen önerileri yeniden sakla">
              gizlenenler dahil ✕
            </Link>
          ) : null}
          {kademeF ? (
            <Link href={matchHref({ kademe: null })} className="rounded-full bg-white px-2 py-0.5 text-xs font-bold hover:text-brand-600" title="Kademe filtresini kaldır">
              {kademeF === "strong" ? "güçlü eşleşme" : "iyi eşleşme"} ✕
            </Link>
          ) : null}
          {minSkorF != null ? (
            <Link href={matchHref({ minSkor: null })} className="rounded-full bg-white px-2 py-0.5 text-xs font-bold hover:text-brand-600" title="Skor filtresini kaldır">
              skor ≥ {minSkorF} ✕
            </Link>
          ) : null}
          <Link href="/app/talepler?sekme=eslesme" className="ml-auto text-xs font-semibold text-brand-600">Filtreyi temizle</Link>
        </div>
      ) : null}

      <SelectionWrap>
      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-display font-bold text-ink-950">
              <Target className="h-4 w-4 text-brand-600" /> Eşleşme önerileri
            </h2>
            <p className="text-xs text-text-muted">
              {filteredPairs.length} öneri · skor ≥ {minSkorF ?? MATCH_SHOW_MIN}
              {kademeF ? ` · ${kademeF === "strong" ? "güçlü" : "iyi"} kademe` : ""}
              {totalPages > 1 ? ` · sayfa ${page}/${totalPages}` : ""}
            </p>
            {hiddenByFeedback + hiddenDismissed > 0 ? (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-amber-700">
                <span>
                  {[
                    hiddenDismissed > 0 ? `${hiddenDismissed} öneri "uygun değil" işaretli` : null,
                    hiddenByFeedback > 0 ? `${hiddenByFeedback} öneriyi müşteri beğenmedi` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {showHidden ? " (listede gösteriliyor)" : " (gizlendi)"}
                </span>
                <Link
                  href={matchHref({ gizlenen: !showHidden })}
                  className="focus-ring inline-flex min-h-8 items-center rounded-full border border-line bg-surface px-2.5 font-semibold text-ink-950 hover:border-brand-300 hover:text-brand-600 touch:min-h-11"
                >
                  {showHidden ? "Gizlenenleri sakla" : "Gizlenenleri göster"}
                </Link>
              </p>
            ) : null}
          </div>
          {bulkDemandIds.length > 0 && propertyF ? <BulkSendMatches propertyId={propertyF} demandIds={bulkDemandIds} sentCount={bulkSentCount} /> : null}
          {selectionCustomerId && top.length > 0 ? <MatchSelectionBar customerId={selectionCustomerId} /> : null}
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
                className="mt-4 rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Skor filtresini temizle
              </Link>
            </div>
          ) : (
          <div className="grid place-items-center px-6 py-14 text-center">
            <Crosshair className="h-8 w-8 text-text-faint" />
            <p className="mt-3 font-display font-bold text-ink-950">Henüz eşleşme yok</p>
            <p className="mt-1 max-w-md text-sm text-text-muted">
              Açık talep ve eşleştirmeye açık (yayında, taslak ya da opsiyonlu) portföy ekleyin. Bütçe / il / oda örtüşünce burada skorlanır.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Link href="/app/musteriler" className="rounded-[var(--radius-control)] bg-brand-600 px-4 py-2 text-sm font-semibold text-white">Müşteriler</Link>
              <Link href="/app/portfoyler" className="rounded-[var(--radius-control)] border border-line px-4 py-2 text-sm font-semibold text-ink-950">Portföyler</Link>
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
                  className={`grid gap-4 px-5 py-4 transition hover:bg-brand-600/[0.02] lg:grid-cols-[1.1fr_1.1fr_auto] lg:items-center ${pair.hiddenBy ? "bg-canvas/60 opacity-75" : ""}`}
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-brand-600">
                      <Users className="h-3 w-3" /> Talep
                    </p>
                    <Link
                      href={customer ? `/app/musteriler/${customer.id}` : "/app/musteriler"}
                      className="mt-1 block truncate font-display text-base font-bold text-ink-950 hover:text-brand-600"
                    >
                      {customer?.full_name ?? (pair.demand.id === PREVIEW_DEMAND_ID ? "Önizleme (kaydedilmemiş talep)" : "Müşteri")}
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
                    <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.08em] text-mint-600">
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
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${tierCls(pair.tier)}`}>
                        {tierLabel(pair.tier)}
                      </span>
                      {pair.likedByCustomer ? (
                        <span
                          className="rounded-full bg-mint-500/12 px-2.5 py-1 text-xs font-bold text-mint-600"
                          title="Müşteri portalında bu portföyü beğendi — skora +10 eklendi"
                        >
                          💚 Müşteri beğendi
                        </span>
                      ) : null}
                    </div>
                    {pair.hiddenBy === "feedback" ? (
                      <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-xs font-semibold text-amber-700">Müşteri beğenmedi</span>
                    ) : null}
                    <MatchStateBadge
                      state={pair.state}
                      nowMs={nowMs}
                      opened={Boolean(pair.state?.share_token && candidates.openedTokens.has(pair.state.share_token))}
                    />
                    <div className="flex flex-wrap gap-1 lg:justify-end">
                      {pair.reasons.filter((r) => r.ok).slice(0, 4).map((r) => (
                        <span key={r.label} className="rounded-full bg-mint-500/10 px-2 py-0.5 text-xs font-semibold text-mint-600">
                          {r.label}
                        </span>
                      ))}
                    </div>
                    {/* Neden eşleşti / neden eşleşmedi: alan bazlı tek satır (explainMatch). */}
                    {(() => {
                      const why = explainMatch({ reasons: pair.reasons, eliminated: false, eliminatedBy: [] });
                      if (why.missed.length === 0 && why.unknown.length === 0) return null;
                      const missedTitle = why.missed
                        .map((m) => `${m.label}${m.required ? " (olmazsa olmaz)" : ""}${m.detail ? `: ${m.detail}` : ""}`)
                        .join("\n");
                      return (
                        <p className="max-w-xs text-xs text-text-muted lg:text-right" title={missedTitle || undefined}>
                          {why.missed.length > 0 ? (
                            <span className="font-semibold text-amber-700">
                              Uymayan: {why.missed.map((m) => m.label).join(", ")}
                            </span>
                          ) : null}
                          {why.missed.length > 0 && why.unknown.length > 0 ? " · " : null}
                          {why.unknown.length > 0 ? <span>Belirsiz: {why.unknown.join(", ")}</span> : null}
                        </p>
                      );
                    })()}
                    {/* Eşleşmeden ileri akış: sunum / randevu / teklif.
                        Önceki halde tek çıkış "Portföyü aç"tı — eşleşme
                        ekranı çıkmaz sokaktı. Üç kısayol da müşteri VE
                        portföyü (randevu talebi de) ön dolgulu taşır — tek
                        sözleşme: prefillHref (src/lib/prefill-params.ts). */}
                    <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                      <Link
                        href={prefillHref("/app/portfoyler/sunumlar/yeni", { propertyId: pair.property.id, customerId: customer?.id })}
                        className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300 hover:text-brand-600"
                        title="Bu portföyle müşteriye özel sunum linki hazırla"
                      >
                        <Presentation className="h-3 w-3" /> Sunum hazırla
                      </Link>
                      <Link
                        href={prefillHref("/app/randevular/yeni", {
                          propertyId: pair.property.id,
                          customerId: customer?.id,
                          demandId: pair.demand.id === PREVIEW_DEMAND_ID ? null : pair.demand.id,
                        })}
                        className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300 hover:text-brand-600"
                        title="Bu portföy için yer gösterme randevusu planla"
                      >
                        <CalendarPlus className="h-3 w-3" /> Randevu ver
                      </Link>
                      {/* B057 / sözleşme k: offers:create yoksa "Teklif al" çizilmez ("rolünüz için kapalı" ekranına düşüş 0). */}
                      {canCreateOffer ? (
                        <Link
                          href={prefillHref("/app/teklifler/yeni", { propertyId: pair.property.id, customerId: customer?.id })}
                          className="focus-ring press inline-flex items-center gap-1 rounded-[var(--radius-control)] border border-line bg-canvas px-2.5 py-1.5 text-xs font-semibold text-ink-950 transition hover:border-brand-300 hover:text-brand-600"
                          title="Müşterinin teklifini ön dolgulu kaydet"
                        >
                          <Tag className="h-3 w-3" /> Teklif al
                        </Link>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                      {selectionCustomerId ? (
                        <MatchSelectCheckbox propertyId={pair.property.id} label={pair.property.title ?? pair.property.property_code ?? "Portföy"} />
                      ) : null}
                      {pair.demand.id === PREVIEW_DEMAND_ID ? null : (
                        <>
                          <SendMatchButton demandId={pair.demand.id} propertyId={pair.property.id} />
                          <SaveMatchButton demandId={pair.demand.id} propertyId={pair.property.id} />
                          <MatchDismissButton
                            demandId={pair.demand.id}
                            propertyId={pair.property.id}
                            dismissed={pair.state?.state === "dismissed"}
                          />
                        </>
                      )}
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
                className="focus-ring press rounded-[var(--radius-control)] border border-line bg-canvas px-3.5 py-2 text-xs font-semibold text-ink-950 transition hover:border-brand-300"
              >
                ← Önceki
              </Link>
            ) : (
              <span className="rounded-[var(--radius-control)] border border-line px-3.5 py-2 text-xs font-semibold text-text-faint">← Önceki</span>
            )}
            <span className="text-xs font-semibold text-text-muted">
              Sayfa {page} / {totalPages}
            </span>
            {page < totalPages ? (
              <Link
                href={matchHref({ sayfa: page + 1 })}
                className="focus-ring press rounded-[var(--radius-control)] border border-line bg-canvas px-3.5 py-2 text-xs font-semibold text-ink-950 transition hover:border-brand-300"
              >
                Sonraki →
              </Link>
            ) : (
              <span className="rounded-[var(--radius-control)] border border-line px-3.5 py-2 text-xs font-semibold text-text-faint">Sonraki →</span>
            )}
          </div>
        ) : null}
      </section>
      </SelectionWrap>
    </div>
  );
}
