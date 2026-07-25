import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CheckCircle2, Copy, Info, Mail, Phone, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { Badge } from "@/components/ui/badge";
import { formatTurkishPhone } from "@/lib/phone";

export const metadata = { title: "Çift kayıt kontrolü" };

type Row = {
  signal: "phone" | "email" | "name";
  match_key: string;
  customer_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  assigned_to: string | null;
  activity: number;
};

const SIGNAL_META: Record<
  Row["signal"],
  { label: string; desc: string; variant: "danger" | "warning" | "info"; icon: typeof Phone }
> = {
  phone: {
    label: "Aynı telefon",
    desc: "Telefon kayıt sırasında normalize ediliyor; aynı numara neredeyse kesin aynı kişidir.",
    variant: "danger",
    icon: Phone,
  },
  email: {
    label: "Aynı e-posta",
    desc: "E-posta adresi paylaşılmadıysa aynı kişidir.",
    variant: "warning",
    icon: Mail,
  },
  name: {
    label: "Aynı ad soyad",
    desc: "Tek başına kanıt değil — “Ali Yılmaz” iki farklı kişi olabilir. Telefon ve geçmişe bakın.",
    variant: "info",
    icon: UserRound,
  },
};

function tarih(iso: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(new Date(iso));
}

/**
 * Çift müşteri kaydı kontrolü (X6).
 *
 * NEDEN VAR: `customers` tablosunda telefon/e-posta üzerinde hiçbir
 * benzersizlik kısıtı yok. Çok danışmanlı bir ofiste aynı kişinin iki kez
 * girilmesi olağan — biri portal lead'inden, biri elle. Sonucu: aynı kişi iki
 * danışman tarafından aranır, lead kaynağı istatistikleri bölünür, görüşme
 * geçmişi ikiye ayrılır ve İYS izni bir kayıtta olup diğerinde olmayabilir.
 *
 * NEDEN OTOMATİK BİRLEŞTİRME YOK: Birleştirme alt kayıtları (talep, randevu,
 * çağrı, görüşme, anlaşma, teklif, sözleşme, görev) taşımayı gerektiren geri
 * alınamaz bir işlem. Yanlış eşleşmede veri kaybı demek — özellikle "aynı ad
 * soyad" sinyali tek başına kanıt değil. Bu sayfa kararı kullanıcıya
 * bırakıyor; hangi kaydın daha dolu olduğunu (aktivite sayısı) göstererek
 * kararı kolaylaştırıyor.
 */
export default async function DuplicateCustomersPage() {
  const { tenantId } = await requireModulePage("customers");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("find_duplicate_customers", { p_tenant_id: tenantId });
  const rows = (data ?? []) as Row[];

  // Satırları (sinyal + anahtar) ikilisine göre gruplandır. SQL zaten güçlü
  // sinyal önce gelecek şekilde sıralıyor; Map ekleme sırasını koruyor.
  const gruplar = new Map<string, { signal: Row["signal"]; key: string; kayitlar: Row[] }>();
  for (const r of rows) {
    const k = `${r.signal}::${r.match_key}`;
    if (!gruplar.has(k)) gruplar.set(k, { signal: r.signal, key: r.match_key, kayitlar: [] });
    gruplar.get(k)!.kayitlar.push(r);
  }
  const liste = [...gruplar.values()];

  const telefonGrup = liste.filter((g) => g.signal === "phone").length;
  const epostaGrup = liste.filter((g) => g.signal === "email").length;
  const adGrup = liste.filter((g) => g.signal === "name").length;
  // Aynı kayıt birden çok sinyalde görünebilir; benzersiz sayıyoruz.
  const etkilenen = new Set(rows.map((r) => r.customer_id)).size;

  return (
    <div className="space-y-6">
      <Link
        href="/app/musteriler"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Müşterilere dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-6 text-white">
        <div className="pointer-events-none absolute inset-0 grid-overlay-dark opacity-35" />
        <div className="pointer-events-none absolute -right-14 -top-16 h-60 w-60 rounded-full bg-amber-400/25 blur-[80px]" />
        <div className="relative">
          <span className="flex items-center gap-2 text-xs font-semibold text-amber-400">
            <Copy className="h-3.5 w-3.5" /> Veri kalitesi
          </span>
          <h1 className="mt-2 font-display text-2xl font-extrabold md:text-3xl">Çift kayıt kontrolü</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/60">
            Aynı kişinin birden çok kez girilmesi lead istatistiklerini böler ve müşterinin iki
            danışman tarafından aranmasına yol açar.
          </p>

          <div className="relative mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Etkilenen kayıt", value: String(etkilenen), icon: UserRound },
              { label: "Aynı telefon", value: String(telefonGrup), icon: Phone },
              { label: "Aynı e-posta", value: String(epostaGrup), icon: Mail },
              { label: "Aynı ad", value: String(adGrup), icon: Copy },
            ].map((k) => (
              <div key={k.label} className="rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur">
                <k.icon className="h-4 w-4 text-amber-400" />
                <p className="numeric mt-2 font-display text-lg font-extrabold text-white">{k.value}</p>
                <p className="text-[10px] text-white/45 sm:text-xs">{k.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {error ? (
        <p className="rounded-[14px] border border-danger-500/30 bg-danger-500/5 px-4 py-3 text-sm text-danger-600" role="alert">
          Çift kayıt taraması çalıştırılamadı. Lütfen sayfayı yenileyin.
        </p>
      ) : liste.length === 0 ? (
        <div className="grid place-items-center rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-16 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-[18px] bg-mint-500/12 text-mint-600">
            <CheckCircle2 className="h-8 w-8" />
          </span>
          <h2 className="mt-5 font-display text-xl font-bold text-ink-950">Çift kayıt bulunamadı</h2>
          <p className="mt-2 max-w-lg text-sm leading-relaxed text-text-muted">
            Telefon, e-posta ve ad soyad üzerinden yapılan taramada birden çok kez girilmiş müşteri
            yok. Bu sayfayı zaman zaman kontrol edin — portal lead&apos;leri ve elle girişler zamanla
            çakışabilir.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {liste.map((g) => {
            const meta = SIGNAL_META[g.signal];
            // En dolu kayıt: birleştirmede genelde bu tutulur.
            const enDolu = Math.max(...g.kayitlar.map((k) => k.activity));
            return (
              <section key={`${g.signal}-${g.key}`} className="surface-card rounded-[var(--radius-panel)] p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      <span className="numeric truncate text-sm font-semibold text-ink-950">
                        {g.signal === "phone" ? formatTurkishPhone(g.key) : g.key}
                      </span>
                    </p>
                    <p className="mt-1 text-[11px] text-text-faint">{meta.desc}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-canvas px-2.5 py-1 text-xs font-semibold text-text-muted">
                    {g.kayitlar.length} kayıt
                  </span>
                </div>

                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {g.kayitlar.map((k) => {
                    const onerilen = k.activity === enDolu && enDolu > 0;
                    return (
                      <li key={k.customer_id}>
                        <Link
                          href={`/app/musteriler/${k.customer_id}`}
                          className={`lift-hover focus-ring group flex h-full items-start justify-between gap-3 rounded-[14px] border p-4 transition ${
                            onerilen ? "border-mint-500/40 bg-mint-500/[0.05]" : "border-line bg-canvas"
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink-950">{k.full_name ?? "İsimsiz"}</p>
                            <p className="numeric mt-0.5 text-xs text-text-muted">
                              {k.phone ? formatTurkishPhone(k.phone) : "Telefon yok"}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-text-muted">{k.email ?? "E-posta yok"}</p>
                            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-faint">
                              <span>{tarih(k.created_at)} tarihinde eklendi</span>
                              <span className="numeric">{k.activity} kayıt hareketi</span>
                              {onerilen ? (
                                <span className="font-semibold text-mint-600">en dolu kayıt</span>
                              ) : null}
                            </p>
                          </div>
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-surface text-text-faint transition group-hover:bg-brand-600/10 group-hover:text-brand-600">
                            <ArrowUpRight className="h-4 w-4" />
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      <p className="flex items-start gap-2 rounded-[14px] border border-line bg-canvas px-4 py-3 text-xs leading-relaxed text-text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
        <span>
          Bu sayfa <strong>birleştirme yapmaz</strong>. Birleştirme; talep, randevu, çağrı, görüşme,
          anlaşma, teklif ve görev kayıtlarını taşımayı gerektiren geri alınamaz bir işlemdir ve
          yanlış eşleşmede veri kaybına yol açar — özellikle &quot;aynı ad soyad&quot; sinyali tek
          başına kanıt değildir. Kararı siz verin: tutacağınız kaydı açın, diğerindeki bilgileri
          taşıyın ve fazlalığı silin. <strong>En dolu kayıt</strong> yeşil çerçeveyle işaretli.
        </span>
      </p>
    </div>
  );
}
