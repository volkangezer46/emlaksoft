import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Gauge, Info, Scale, TrendingUp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { Table, TableFrame, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PrintButton } from "./print-button";

export const metadata = { title: "Değerleme raporu" };

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

/**
 * Değerleme raporu — müşteriye elden verilen belge.
 *
 * NEDEN VAR: Değerleme oluşturuluyordu ama HİÇBİR ÇIKTISI YOKTU. Sonuç
 * yalnızca liste sayfasında bir satır olarak görünüyordu; danışmanın müşteriye
 * verebileceği bir belge üretmesi mümkün değildi. Bu işin tamamlanmamış olması
 * değerleme özelliğinin asıl amacını boşa çıkarıyordu.
 *
 * ÇIKTI: Tarayıcının "PDF olarak kaydet" akışı (`globals.css` içindeki
 * `@media print` katmanı). Ayrı bir PDF kütüphanesi bilinçli olarak
 * eklenmedi — gerekçesi print-button.tsx içinde.
 *
 * DÜRÜSTLÜK: Rapor, hangi kaynağın sonuca ne ağırlıkla girdiğini açıkça
 * gösteriyor ve altında bunun bir eksper raporu OLMADIĞI yazıyor. Değerleme
 * bir tahmindir; belgeyi eline alan müşterinin bunu bilmesi gerekir.
 */
export default async function ValuationReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { tenantId } = await requireModulePage("valuation");
  const { id } = await params;
  const supabase = await createClient();

  /*
   * Neden tek gomulu sorgu degil: valuations -> properties -> geo_* iki
   * seviyeli gomme, uzerine created_by icin FK ipucu eklenince supabase-js'in
   * tip cikarimi satiri GenericStringError'a dusuruyor ve tum alanlar
   * erisilemez oluyor. Bu sayfa nadiren aciliyor; iki ek gidis-donus bedava
   * sayilir, karsiliginda tipler dogru calisiyor.
   */
  const [{ data: valuation }, { data: office }] = await Promise.all([
    supabase
      .from("valuations")
      .select(
        "id, title, estimated_low, estimated_mid, estimated_high, confidence, sources, notes, created_at, property_id, created_by",
      )
      .eq("id", id)
      .maybeSingle(),
    tenantId
      ? supabase.from("tenants").select("name, plan").eq("id", tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // RLS zaten kiracı dışını göstermiyor; burada yalnızca "yok" durumunu ele alıyoruz.
  if (!valuation) notFound();

  const [{ data: property }, { data: author }] = await Promise.all([
    valuation.property_id
      ? supabase
          .from("properties")
          .select(
            "property_code, title, address_line, list_price, features, province:geo_provinces(name), district:geo_districts(name)",
          )
          .eq("id", valuation.property_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    valuation.created_by
      ? supabase.from("profiles").select("full_name").eq("id", valuation.created_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const sources = (Array.isArray(valuation.sources) ? valuation.sources : []) as ValuationSource[];
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

  // Güven yüzdesi 0-1 ya da 0-100 gelebiliyor; ikisini de tek biçime indir.
  const rawConf = valuation.confidence != null ? Number(valuation.confidence) : null;
  const confidencePct = rawConf == null ? null : rawConf <= 1 ? Math.round(rawConf * 100) : Math.round(rawConf);

  const sqmPrice = mid != null && sqm && sqm > 0 ? Math.round(mid / sqm) : null;
  const listDelta =
    mid != null && listPrice != null && mid > 0 ? Math.round(((listPrice - mid) / mid) * 1000) / 10 : null;

  const konum = [province?.name, district?.name].filter(Boolean).join(" / ") || "Belirtilmedi";

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/app/degerleme"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
        >
          <ArrowLeft className="h-4 w-4" /> Değerleme merkezine dön
        </Link>
        <PrintButton />
      </div>

      <article className="print-sheet surface-card rounded-[var(--radius-panel)] p-6 sm:p-8">
        {/* Rapor başlığı — çıktıda ofis adı belgenin üst bandı oluyor. */}
        <header className="hairline-b flex flex-wrap items-start justify-between gap-4 pb-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600">
              {office?.name ?? "Emlak ofisi"}
            </p>
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

          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
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
            <div className="rounded-[12px] border border-line bg-canvas px-4 py-2.5">
              <dt className="text-[11px] text-text-faint">Liste fiyatı farkı</dt>
              <dd className="numeric text-sm font-bold text-ink-950">
                {listDelta == null
                  ? "—"
                  : `%${Math.abs(listDelta)} ${listDelta > 0 ? "yüksek" : listDelta < 0 ? "düşük" : "denk"}`}
              </dd>
            </div>
          </dl>
        </section>

        {/* Taşınmaz künyesi */}
        <section className="print-avoid-break mt-7">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
            <Building2 className="h-4 w-4 text-brand-600" /> Taşınmaz bilgileri
          </h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {[
              ["Portföy kodu", property?.property_code ?? "—"],
              ["Başlık", property?.title ?? "—"],
              ["Konum", konum],
              ["Adres", property?.address_line ?? "—"],
              ["Brüt m²", sqm ? `${sqm} m²` : "—"],
              ["Oda", features.rooms ?? "—"],
              ["Liste fiyatı", money(listPrice)],
            ].map(([k, v]) => (
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

        {valuation.notes ? (
          <section className="print-avoid-break mt-7">
            <h2 className="font-display text-base font-bold text-ink-950">Notlar</h2>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-muted">{valuation.notes}</p>
          </section>
        ) : null}

        {/* Yasal çerçeve — belge elden verildiği için burada olması şart. */}
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

          {/* Islak imza alanı yalnızca çıktıda — ekranda yer kaplamasın. */}
          <div className="print-only mt-10 grid grid-cols-2 gap-12">
            <div>
              <div className="hairline-t pt-1.5 text-[11px] text-text-muted">Hazırlayan · {author?.full_name ?? ""}</div>
            </div>
            <div>
              <div className="hairline-t pt-1.5 text-[11px] text-text-muted">Teslim alan · ad, soyad, tarih</div>
            </div>
          </div>
        </footer>
      </article>
    </div>
  );
}
