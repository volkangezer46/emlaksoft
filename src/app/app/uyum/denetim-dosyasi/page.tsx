import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileCheck2, Info } from "lucide-react";
import { requireModulePage } from "@/lib/require-module-page";
import { buildAuditDossier } from "@/app/actions/audit-dossier";
import { PrintButton } from "@/app/app/degerleme/[id]/print-button";

export const metadata = { title: "Denetim dosyası" };

function money(n: number) {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n) + " ₺";
}

function tarih(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" }).format(new Date(iso));
}

/**
 * Denetim dosyası (X10).
 *
 * NEDEN VAR: Taşınmaz Ticareti Yönetmeliği kapsamında bir denetimde yetki
 * belgeleri, sözleşmeler, hizmet bedeli kayıtları ve İYS rızaları istenir.
 * Bu veriler sistemde vardı ama BEŞ AYRI SAYFAYA dağılmıştı; denetim anında
 * tek tek toplamak gerekiyordu.
 *
 * NEDEN ZIP DEĞİL: `archiver`/`jszip` bir bağımlılık ister ve asıl değerin
 * küçük bir kısmını verir — denetmen evrakı ekranda ya da kağıtta görmek
 * istiyor, arşiv dosyası olarak değil. Tek sayfalık yazdırılabilir dosya,
 * mevcut `@media print` katmanıyla tarayıcının "PDF olarak kaydet" akışına
 * bağlanıyor.
 *
 * NEDEN EKSİKLERİ DE GÖSTERİYOR: Yalnızca iyi tarafı gösteren bir denetim
 * dosyası denetime hazırlık değil, kendini kandırmadır. Eksikler en üstte.
 */
export default async function AuditDossierPage() {
  await requireModulePage("compliance");
  const d = await buildAuditDossier();
  if (!d) notFound();

  const yetkiOran = d.yetki.toplam > 0 ? Math.round((d.yetki.belgeli / d.yetki.toplam) * 100) : null;

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/app/uyum"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
        >
          <ArrowLeft className="h-4 w-4" /> Uyum merkezine dön
        </Link>
        <PrintButton />
      </div>

      <article className="print-sheet surface-card rounded-[var(--radius-panel)] p-6 sm:p-8">
        <header className="hairline-b flex flex-wrap items-start justify-between gap-4 pb-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-brand-600">
              {d.ofis?.name ?? "Emlak ofisi"}
            </p>
            <h1 className="mt-1 font-display text-2xl font-extrabold tracking-[-0.02em] text-ink-950">
              Denetim dosyası
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              Kapsam: {tarih(d.donem.from)} – {tarih(d.donem.to)}
            </p>
          </div>
          <dl className="text-right text-xs text-text-muted">
            {[
              ["Yetki belgesi no", d.ofis?.license_no],
              ["Vergi dairesi", d.ofis?.tax_office],
              ["Vergi no", d.ofis?.tax_number],
              ["Telefon", d.ofis?.phone],
            ].map(([k, v]) => (
              <div key={k as string} className="flex justify-end gap-2">
                <dt>{k}</dt>
                <dd className="numeric font-semibold text-ink-950">{v || "—"}</dd>
              </div>
            ))}
          </dl>
        </header>

        {/* EKSİKLER EN ÜSTTE — dosyanın en değerli kısmı */}
        <section className="print-avoid-break mt-6">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-ink-950">
            {d.eksikler.length > 0 ? (
              <>
                <AlertTriangle className="h-4 w-4 text-danger-600" /> Denetimde sorulabilecek eksikler
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4 text-mint-600" /> Mekanik kontrollerde eksik yok
              </>
            )}
          </h2>

          {d.eksikler.length === 0 ? (
            <p className="mt-2 rounded-[12px] border border-mint-500/30 bg-mint-500/[0.06] px-4 py-3 text-sm text-mint-600">
              Yetki belgeleri, komisyon oranları, İYS rızaları ve sözleşme durumları üzerinde yapılan
              otomatik kontrollerde bir eksik bulunamadı. Bu, denetimin sorunsuz geçeceği anlamına
              gelmez — yalnızca sistemde tespit edilebilen eksik yok demektir.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {d.eksikler.map((e) => (
                <li
                  key={e.baslik}
                  className="print-avoid-break rounded-[12px] border border-danger-500/25 bg-danger-500/[0.04] px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <p className="text-sm font-semibold text-ink-950">{e.baslik}</p>
                    <span className="numeric rounded-full bg-danger-500/10 px-2.5 py-0.5 text-xs font-bold text-danger-600">
                      {e.adet}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">{e.aciklama}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Yetki belgesi */}
        <section className="print-avoid-break mt-7">
          <h2 className="font-display text-base font-bold text-ink-950">Yetki belgesi durumu</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-4">
            {[
              ["Toplam portföy", String(d.yetki.toplam)],
              ["Belge tarihi girili", yetkiOran != null ? `${d.yetki.belgeli} (%${yetkiOran})` : String(d.yetki.belgeli)],
              ["Süresi geçmiş", String(d.yetki.suresiGecmis)],
              ["15 gün içinde dolan", String(d.yetki.yakinda)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[12px] border border-line bg-canvas px-4 py-2.5">
                <dt className="text-[11px] text-text-faint">{k}</dt>
                <dd className="numeric text-sm font-bold text-ink-950">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Sözleşmeler */}
        <section className="print-avoid-break mt-7">
          <h2 className="font-display text-base font-bold text-ink-950">Sözleşmeler</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-4">
            {[
              ["Toplam", String(d.sozlesme.toplam)],
              ["İmzalı", String(d.sozlesme.imzali)],
              ["Taslak", String(d.sozlesme.taslak)],
              ["İptal", String(d.sozlesme.iptal)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[12px] border border-line bg-canvas px-4 py-2.5">
                <dt className="text-[11px] text-text-faint">{k}</dt>
                <dd className="numeric text-sm font-bold text-ink-950">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Hizmet bedeli */}
        <section className="print-avoid-break mt-7">
          <h2 className="font-display text-base font-bold text-ink-950">Hizmet bedeli (komisyon)</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              ["Kayıt sayısı", String(d.hizmetBedeli.kayitSayisi)],
              ["Brüt toplam", money(d.hizmetBedeli.brutToplam)],
              ["KDV toplam", money(d.hizmetBedeli.kdvToplam)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[12px] border border-line bg-canvas px-4 py-2.5">
                <dt className="text-[11px] text-text-faint">{k}</dt>
                <dd className="numeric text-sm font-bold text-ink-950">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* İYS ve KVKK */}
        <section className="print-avoid-break mt-7">
          <h2 className="font-display text-base font-bold text-ink-950">İYS rızaları ve KVKK</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-4">
            {[
              ["Rıza kaydı", String(d.iys.toplam)],
              ["İzinli", String(d.iys.izinli)],
              ["Rızası olmayan müşteri", String(d.iys.rizasizMusteri)],
              ["İşlenmiş silme talebi", String(d.kvkk.silmeTalebi)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[12px] border border-line bg-canvas px-4 py-2.5">
                <dt className="text-[11px] text-text-faint">{k}</dt>
                <dd className="numeric text-sm font-bold text-ink-950">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* Denetim izi */}
        <section className="print-avoid-break mt-7">
          <h2 className="font-display text-base font-bold text-ink-950">Denetim izi</h2>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3">
            {[
              ["Kayıt sayısı", String(d.denetimIzi.kayitSayisi)],
              ["İlk kayıt", tarih(d.denetimIzi.ilk)],
              ["Son kayıt", tarih(d.denetimIzi.son)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-[12px] border border-line bg-canvas px-4 py-2.5">
                <dt className="text-[11px] text-text-faint">{k}</dt>
                <dd className="numeric text-sm font-bold text-ink-950">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <footer className="hairline-t mt-8 pt-5">
          <p className="flex items-start gap-2 text-[11px] leading-relaxed text-text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-600" />
            <span>
              Bu dosya sistemdeki kayıtlardan <strong>otomatik</strong> üretilmiştir ve bir özettir;
              satır bazlı döküm için ilgili sayfalardaki CSV dışa aktarımlarını kullanın. Mekanik
              kontroller yalnızca sistemde <strong>tespit edilebilen</strong> eksikleri gösterir —
              hukuki uygunluk beyanı değildir. Komisyon oranı uyarısı bir teyit çağrısıdır, hukuki
              tespit değil.
            </span>
          </p>

          <div className="print-only mt-10 grid grid-cols-2 gap-12">
            <div className="hairline-t pt-1.5 text-[11px] text-text-muted">Hazırlayan · ad, soyad, tarih</div>
            <div className="hairline-t pt-1.5 text-[11px] text-text-muted">Teslim alan · ad, soyad, tarih</div>
          </div>
        </footer>
      </article>

      <p className="no-print flex items-start gap-2 rounded-[14px] border border-line bg-canvas px-4 py-3 text-xs leading-relaxed text-text-muted">
        <FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
        <span>
          <strong>Yazdır / PDF</strong> düğmesi tek dosyalık, seçilebilir metinli bir çıktı üretir.
          ZIP arşivi bilinçli olarak eklenmedi: bir bağımlılık gerektirir ve denetmen evrakı ekranda
          ya da kağıtta ister.
        </span>
      </p>
    </div>
  );
}
