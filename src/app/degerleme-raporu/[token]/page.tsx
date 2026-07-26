import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, Gauge, Info, Scale, ShieldCheck, TrendingUp } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  COMPARABLES_SOURCE_NAME,
  extractStoredComparables,
  listComparableDetails,
  type ComparableDetail,
} from "@/lib/comparables";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ShareButton } from "@/components/public/share-button";

type ValuationSource = { name: string; weight: number; value: number; note: string };

function money(n: number | null) {
  if (n == null) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

function tarih(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" }).format(new Date(iso));
}

/** supabase-js gömülü ilişkiyi dizi olarak tipleyebilir; iki biçimi de karşıla. */
function rel<T>(value: T | T[] | null): T | null {
  if (!value) return null;
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

// Paylaşım linkleri kişiye özeldir → arama motorlarına kapalı (paylas/[token] deseni).
export const metadata: Metadata = {
  title: "Değerleme raporu",
  robots: { index: false, follow: false },
};

/**
 * Değerleme raporunun PUBLIC, salt okunur sürümü.
 *
 * /app/degerleme/[id] raporunun markalı kopyası: iç linkler ve aksiyonlar yok,
 * token'ı bilen (danışmanın WhatsApp'la gönderdiği) müşteri raporu tarayıcıda
 * görür ve isterse yazdırır. Token `valuations.share_token` kolonunda; RLS
 * anon'a açılmadığı için sorgular service role ile yapılır (paylas/[token]
 * sayfasındaki desen).
 */
export default async function PublicValuationReportPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  // share_token uuid tipinde; uuid olmayan girdi sorguya gitmeden 404 olsun.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) notFound();

  const admin = createAdminClient();
  const { data: valuation } = await admin
    .from("valuations")
    .select(
      "id, tenant_id, title, estimated_low, estimated_mid, estimated_high, confidence, sources, notes, created_at, property_id, created_by",
    )
    .eq("share_token", token)
    .maybeSingle();

  if (!valuation) notFound();

  const [{ data: office }, { data: property }, { data: author }] = await Promise.all([
    admin.from("tenants").select("name").eq("id", valuation.tenant_id).maybeSingle(),
    valuation.property_id
      ? admin
          .from("properties")
          .select(
            "property_code, title, address_line, list_price, features, district_id, property_type, transaction_type, province:geo_provinces(name), district:geo_districts(name)",
          )
          .eq("id", valuation.property_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    valuation.created_by
      ? admin.from("profiles").select("full_name").eq("id", valuation.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const officeName = office?.name ?? "Emlak ofisi";
  // Emsal anlık görüntüsü sources jsonb'sinde saklanıyor; listelere sızmasın.
  const storedComparables = extractStoredComparables(valuation.sources);
  const sources = (Array.isArray(valuation.sources) ? valuation.sources : []).filter(
    (s: ValuationSource) => s.name !== COMPARABLES_SOURCE_NAME,
  ) as ValuationSource[];
  const priceSources = sources.filter((s) => s.weight > 0);
  const infoSources = sources.filter((s) => s.weight === 0);

  const province = property ? rel(property.province as { name: string } | { name: string }[] | null) : null;
  const district = property ? rel(property.district as { name: string } | { name: string }[] | null) : null;
  const features = (property?.features ?? {}) as { sqm?: number | string | null; rooms?: string | null };
  const sqm = features.sqm != null ? Number(features.sqm) : null;

  const mid = valuation.estimated_mid != null ? Number(valuation.estimated_mid) : null;
  const low = valuation.estimated_low != null ? Number(valuation.estimated_low) : null;
  const high = valuation.estimated_high != null ? Number(valuation.estimated_high) : null;
  const listPrice = property?.list_price != null ? Number(property.list_price) : null;

  const rawConf = valuation.confidence != null ? Number(valuation.confidence) : null;
  const confidencePct = rawConf == null ? null : rawConf <= 1 ? Math.round(rawConf * 100) : Math.round(rawConf);

  const sqmPrice = mid != null && sqm && sqm > 0 ? Math.round(mid / sqm) : null;
  const konum = [province?.name, district?.name].filter(Boolean).join(" / ") || "Belirtilmedi";

  // Kullanılan emsaller: yeni kayıtlarda kayda gömülü; eski kayıtlarda portföy
  // bağlıysa aynı parametrelerle görüntüleme anında yeniden hesaplanır.
  // PUBLIC sayfada portföy kodları MASKELENİR ("Emsal 1..N") — müşteri,
  // ofisin diğer portföy kodlarını bu rapordan öğrenmemeli.
  let comparableRows: ComparableDetail[] = storedComparables ?? [];
  let comparablesRecomputed = false;
  if (!storedComparables && property?.district_id && property.property_type && property.transaction_type && sqm) {
    comparableRows = await listComparableDetails(admin, {
      tenantId: valuation.tenant_id,
      districtId: property.district_id,
      propertyType: property.property_type,
      transactionType: property.transaction_type,
      sqm,
      excludePropertyId: valuation.property_id,
    });
    comparablesRecomputed = comparableRows.length > 0;
  }
  comparableRows = comparableRows.slice(0, 8);
  const sourceLabel = (s: ComparableDetail["source"]) =>
    s === "won_deal" ? "Kapanış (satış)" : "Ofis portföyü";

  return (
    <div className="min-h-screen bg-canvas px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-3xl space-y-5">
        {/* Marka bandı — raporu kimin gönderdiği ilk bakışta belli olsun. */}
        <div className="no-print flex items-center justify-center gap-2 text-xs font-semibold text-text-muted">
          <span className="grid h-6 w-6 place-items-center rounded-[8px] bg-brand-600/10 text-[11px] font-bold text-brand-600">
            {officeName[0]}
          </span>
          Bu rapor {officeName} tarafından hazırlanmıştır
          <ShieldCheck className="h-3.5 w-3.5 text-mint-600" />
          {/* Web Share: link o anki rapor adresi (window.location) */}
          <ShareButton title={`Değerleme raporu — ${valuation.title ?? officeName}`} className="ml-1" />
        </div>

        <article className="print-sheet surface-card rounded-[var(--radius-panel)] p-6 sm:p-8">
          <header className="hairline-b flex flex-wrap items-start justify-between gap-4 pb-5">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600">{officeName}</p>
              <h1 className="mt-1 font-display text-2xl font-extrabold tracking-[-0.02em] text-ink-950">
                Değerleme raporu
              </h1>
              <p className="mt-1 text-sm text-text-muted">{valuation.title ?? "Başlıksız değerleme"}</p>
            </div>
            <dl className="text-right text-xs text-text-muted">
              <div className="flex justify-end gap-2">
                <dt>Rapor tarihi</dt>
                <dd className="font-semibold text-ink-950">{tarih(valuation.created_at)}</dd>
              </div>
              <div className="mt-1 flex justify-end gap-2">
                <dt>Hazırlayan</dt>
                <dd className="font-semibold text-ink-950">{author?.full_name ?? "—"}</dd>
              </div>
              <div className="mt-1 flex justify-end gap-2">
                <dt>Rapor no</dt>
                <dd className="numeric font-semibold text-ink-950">{valuation.id.slice(0, 8).toUpperCase()}</dd>
              </div>
            </dl>
          </header>

          {/* Değer aralığı — belgenin ana sonucu */}
          <section className="print-avoid-break mt-6">
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
              <Gauge className="h-4 w-4 text-brand-600" /> Tahmini değer
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {[
                { label: "Alt sınır", value: money(low), tone: "text-text-muted" },
                { label: "Beklenen değer", value: money(mid), tone: "text-brand-600", big: true },
                { label: "Üst sınır", value: money(high), tone: "text-text-muted" },
              ].map((x) => (
                <div
                  key={x.label}
                  className={`rounded-[14px] border px-4 py-3 ${
                    x.big ? "border-brand-300/50 bg-brand-600/5" : "border-line bg-canvas"
                  }`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">{x.label}</p>
                  <p className={`numeric mt-1 font-display font-extrabold ${x.tone} ${x.big ? "text-2xl" : "text-lg"}`}>
                    {x.value}
                  </p>
                </div>
              ))}
            </div>

            <dl className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[12px] border border-line bg-canvas px-4 py-2.5">
                <dt className="text-[11px] text-text-faint">m² birim değeri</dt>
                <dd className="numeric text-sm font-bold text-ink-950">
                  {sqmPrice != null ? money(sqmPrice) : "m² bilgisi girilmemiş"}
                </dd>
              </div>
              <div className="rounded-[12px] border border-line bg-canvas px-4 py-2.5">
                <dt className="text-[11px] text-text-faint">Güven düzeyi</dt>
                <dd className="numeric text-sm font-bold text-ink-950">
                  {confidencePct != null ? `%${confidencePct}` : "—"}
                </dd>
              </div>
            </dl>
          </section>

          {/* Taşınmaz künyesi — iç sayfadan farkı: hiçbir alan linke gitmez. */}
          <section className="print-avoid-break mt-7">
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
              <Building2 className="h-4 w-4 text-brand-600" /> Taşınmaz bilgileri
            </h2>
            <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {([
                ["Portföy kodu", property?.property_code ?? "—"],
                ["Başlık", property?.title ?? "—"],
                ["Konum", konum],
                ["Adres", property?.address_line ?? "—"],
                ["Brüt m²", sqm ? `${sqm} m²` : "—"],
                ["Oda", features.rooms ?? "—"],
                ["Liste fiyatı", money(listPrice)],
              ] as Array<[string, React.ReactNode]>).map(([k, v]) => (
                <div key={k} className="hairline-b flex justify-between gap-4 py-1.5">
                  <dt className="text-sm text-text-muted">{k}</dt>
                  <dd className="text-sm font-semibold text-ink-950">{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          {/* Kaynak dökümü — raporun güvenilirliği burada */}
          <section className="mt-7">
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
              <Scale className="h-4 w-4 text-brand-600" /> Değere katkı veren kaynaklar
            </h2>
            {priceSources.length === 0 ? (
              <p className="mt-3 rounded-[12px] border border-dashed border-line-strong px-4 py-6 text-center text-sm text-text-muted">
                Bu değerlemede ağırlıklı bir fiyat kaynağı kaydedilmemiş.
              </p>
            ) : (
              <TableFrame className="mt-3" minWidth={520}>
                <Table>
                  <THead>
                    <TR>
                      <TH>Kaynak</TH>
                      <TH align="right">Ağırlık</TH>
                      <TH align="right">Değer</TH>
                      <TH>Açıklama</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {priceSources.map((s) => (
                      <TR key={s.name}>
                        <TD className="font-semibold text-ink-950">{s.name}</TD>
                        <TD align="right">%{Math.round(s.weight * 100)}</TD>
                        <TD align="right">{money(s.value)}</TD>
                        <TD className="text-text-muted">{s.note}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableFrame>
            )}

            {infoSources.length > 0 ? (
              <>
                <h3 className="mt-5 flex items-center gap-2 text-sm font-bold text-ink-950">
                  <TrendingUp className="h-3.5 w-3.5 text-mint-600" /> Bilgi amaçlı göstergeler
                </h3>
                <p className="mt-1 text-[11px] text-text-faint">
                  Aşağıdakiler değer hesabına <strong>girmez</strong>; yalnızca bağlam sunar.
                </p>
                <ul className="mt-2 space-y-1.5">
                  {infoSources.map((s) => (
                    <li key={s.name} className="flex flex-wrap gap-x-2 text-sm">
                      <span className="font-semibold text-ink-950">{s.name}:</span>
                      <span className="text-text-muted">{s.note}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </section>

          {/* Kullanılan emsaller — kodlar maskeli, link yok (public) */}
          {comparableRows.length > 0 ? (
            <section className="print-avoid-break mt-7">
              <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
                <Building2 className="h-4 w-4 text-brand-600" /> Kullanılan emsaller
              </h2>
              <p className="mt-1 text-[11px] text-text-faint">
                Emsal motoru bu kayıtlara dayandı — aynı ilçe/tip, m² bandı ±%30, son 18 ay.
                Gizlilik gereği portföy kimlikleri maskelenmiştir.
              </p>
              <TableFrame className="mt-3" minWidth={620}>
                <Table>
                  <THead>
                    <TR>
                      <TH>Emsal</TH>
                      <TH>İlçe</TH>
                      <TH>Oda</TH>
                      <TH align="right">m²</TH>
                      <TH align="right">Fiyat</TH>
                      <TH align="right">₺/m²</TH>
                      <TH>Kaynak</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {comparableRows.map((c, i) => (
                      <TR key={`${c.property_id}-${c.source}-${i}`}>
                        <TD className="font-semibold text-ink-950">{`Emsal ${i + 1}`}</TD>
                        <TD>{c.district_name ?? district?.name ?? "—"}</TD>
                        <TD>{c.rooms ?? "—"}</TD>
                        <TD align="right">{c.sqm != null ? `${c.sqm}` : "—"}</TD>
                        <TD align="right">{money(c.price)}</TD>
                        <TD align="right">{c.price_per_sqm != null ? money(c.price_per_sqm) : "—"}</TD>
                        <TD className="text-text-muted">{sourceLabel(c.source)}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </TableFrame>
              {comparablesRecomputed ? (
                <p className="mt-2 text-[11px] text-text-faint">
                  Emsaller görüntüleme anında güncel verilerle yeniden hesaplanmıştır; rapor
                  tarihindeki kümeden farklı olabilir.
                </p>
              ) : null}
            </section>
          ) : null}

          {valuation.notes ? (
            <section className="print-avoid-break mt-7">
              <h2 className="font-display text-base font-bold text-ink-950">Notlar</h2>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-muted">{valuation.notes}</p>
            </section>
          ) : null}

          {/* Yasal çerçeve — belge müşterinin elinde dolaşacağı için şart. */}
          <footer className="hairline-t mt-8 pt-5">
            <p className="flex items-start gap-2 text-[11px] leading-relaxed text-text-muted">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
              <span>
                Bu rapor bir <strong>ön değer tahminidir</strong>; SPK lisanslı gayrimenkul değerleme
                uzmanınca düzenlenmiş resmî bir ekspertiz raporu <strong>değildir</strong>. Kredi, teminat,
                mahkeme ya da resmî işlemlerde kullanılamaz. Tahmin, yukarıda listelenen kaynaklardan
                rapor tarihindeki verilerle üretilmiştir; piyasa koşulları değiştikçe değer de değişir.
              </span>
            </p>
            <p className="mt-4 text-[11px] font-semibold text-text-muted">
              Bu rapor {officeName} tarafından hazırlanmıştır. Sorularınız için ofisinizle iletişime geçin.
            </p>
          </footer>
        </article>

        <p className="no-print text-center text-[11px] text-text-faint">
          Bu sayfa salt okunur bir paylaşım linkidir ·{" "}
          <Link href="/" className="font-semibold underline-offset-2 transition hover:text-text-muted hover:underline">
            Powered by EmlakSoft
          </Link>
        </p>
      </div>
    </div>
  );
}
