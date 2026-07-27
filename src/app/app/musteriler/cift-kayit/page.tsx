import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CheckCircle2, Copy, Info, Mail, Phone, UserRound } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireModulePage } from "@/lib/require-module-page";
import { DuplicateGroupsClient } from "./groups-client";

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

/**
 * Çift müşteri kaydı kontrolü (X6).
 *
 * NEDEN VAR: `customers` tablosunda telefon/e-posta üzerinde hiçbir
 * benzersizlik kısıtı yok. Çok danışmanlı bir ofiste aynı kişinin iki kez
 * girilmesi olağan — biri portal lead'inden, biri elle. Sonucu: aynı kişi iki
 * danışman tarafından aranır, lead kaynağı istatistikleri bölünür, görüşme
 * geçmişi ikiye ayrılır ve İYS izni bir kayıtta olup diğerinde olmayabilir.
 *
 * NEDEN SİHİRBAZLI (OTOMATİK DEĞİL) BİRLEŞTİRME: Birleştirme alt kayıtları
 * (talep, randevu, çağrı, görüşme, anlaşma, teklif, sözleşme, görev...)
 * taşımayı gerektiren geri alınamaz bir işlem. Yanlış eşleşmede veri kaybı
 * demek — özellikle "aynı ad soyad" sinyali tek başına kanıt değil. Bu
 * yüzden birleştirme hiçbir zaman otomatik çalışmaz: kullanıcı üç adımlı
 * sihirbazda ana kaydı seçer, taşınacakların özetini görür ve ayrı bir
 * onayla işlemi başlatır (bkz. merge-wizard.tsx / mergeCustomers).
 * Yanlış eşleşen gruplar "Bu grup mükerrer değil" ile cihaz bazında
 * gizlenebilir (localStorage — DB'siz hafif çözüm, bkz. groups-client.tsx).
 */
export default async function DuplicateCustomersPage({
  searchParams,
}: {
  searchParams?: Promise<{ signal?: string }>;
}) {
  const { tenantId } = await requireModulePage("customers");
  const supabase = await createClient();
  const sp = (await searchParams) ?? {};
  const signalF: Row["signal"] | "" =
    sp.signal === "phone" || sp.signal === "email" || sp.signal === "name" ? sp.signal : "";

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
  // KPI'lar tam kümeden sayılır; ?signal= yalnızca aşağıdaki listeyi daraltır.
  const gosterilen = signalF ? liste.filter((g) => g.signal === signalF) : liste;

  const telefonGrup = liste.filter((g) => g.signal === "phone").length;
  const epostaGrup = liste.filter((g) => g.signal === "email").length;
  const adGrup = liste.filter((g) => g.signal === "name").length;
  // Aynı kayıt birden çok sinyalde görünebilir; benzersiz sayıyoruz.
  const etkilenen = new Set(rows.map((r) => r.customer_id)).size;

  const sinyalSekmeleri = [
    { key: "" as const, label: "Tümü", count: liste.length },
    { key: "phone" as const, label: SIGNAL_META.phone.label, count: telefonGrup },
    { key: "email" as const, label: SIGNAL_META.email.label, count: epostaGrup },
    { key: "name" as const, label: SIGNAL_META.name.label, count: adGrup },
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/app/musteriler"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-muted transition hover:text-brand-600"
      >
        <ArrowLeft className="h-4 w-4" /> Müşterilere dön
      </Link>

      <section className="theme-dark relative overflow-hidden rounded-[22px] bg-[image:var(--grad-ink)] p-4 text-white md:p-6">
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
              { label: "Etkilenen kayıt", value: String(etkilenen), icon: UserRound, href: "/app/musteriler/cift-kayit" },
              { label: "Aynı telefon", value: String(telefonGrup), icon: Phone, href: "/app/musteriler/cift-kayit?signal=phone" },
              { label: "Aynı e-posta", value: String(epostaGrup), icon: Mail, href: "/app/musteriler/cift-kayit?signal=email" },
              { label: "Aynı ad", value: String(adGrup), icon: Copy, href: "/app/musteriler/cift-kayit?signal=name" },
            ].map((k) => (
              <Link
                key={k.label}
                href={k.href}
                className="focus-ring press lift group block rounded-[14px] border border-white/10 bg-white/5 p-3 backdrop-blur transition hover:border-brand-300"
              >
                <div className="flex items-start justify-between">
                  <k.icon className="h-4 w-4 text-amber-400" />
                  <ArrowUpRight className="hover-action h-4 w-4 text-text-faint opacity-0 transition group-hover:text-brand-600 group-hover:opacity-100" />
                </div>
                <p className="numeric mt-2 font-display text-lg font-extrabold text-white">{k.value}</p>
                <p className="text-[11px] text-white/45 sm:text-xs">{k.label}</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Sinyal türü filtre sekmeleri — hero KPI'larıyla aynı ?signal= kontratı */}
      {liste.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {sinyalSekmeleri.map((s) => {
            const active = s.key === signalF;
            const href = s.key ? `/app/musteriler/cift-kayit?signal=${s.key}` : "/app/musteriler/cift-kayit";
            return (
              <Link
                key={s.key || "all"}
                href={href}
                className={`focus-ring press rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                  active
                    ? "bg-brand-600 text-white"
                    : "border border-line bg-surface text-text-muted hover:border-brand-400 hover:text-brand-600"
                }`}
              >
                {s.label} <span className={active ? "text-white/70" : "text-text-faint"}>{s.count}</span>
              </Link>
            );
          })}
        </div>
      ) : null}

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
      ) : gosterilen.length === 0 ? (
        <div className="grid place-items-center rounded-[20px] border border-dashed border-line-strong bg-surface px-6 py-14 text-center">
          <CheckCircle2 className="h-8 w-8 text-mint-600" />
          <h2 className="mt-3 font-display text-lg font-bold text-ink-950">Bu sinyalde çift kayıt yok</h2>
          <p className="mt-1 text-sm text-text-muted">
            {signalF ? SIGNAL_META[signalF].label : "Seçili"} sinyalinde eşleşen grup bulunamadı.
          </p>
          <Link href="/app/musteriler/cift-kayit" className="mt-4 text-sm font-semibold text-brand-600 hover:underline">
            Tüm sinyalleri göster
          </Link>
        </div>
      ) : (
        <DuplicateGroupsClient
          groups={gosterilen.map((g) => ({
            signal: g.signal,
            key: g.key,
            kayitlar: g.kayitlar.map((k) => ({
              customer_id: k.customer_id,
              full_name: k.full_name,
              phone: k.phone,
              email: k.email,
              created_at: k.created_at,
              activity: k.activity,
            })),
          }))}
        />
      )}

      <p className="flex items-start gap-2 rounded-[14px] border border-line bg-canvas px-4 py-3 text-xs leading-relaxed text-text-muted">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
        <span>
          Birleştirme; talep, randevu, çağrı, görüşme, anlaşma, teklif ve görev kayıtlarını taşıyan{" "}
          <strong>geri alınamaz</strong> bir işlemdir ve yanlış eşleşmede veriler karışır —
          özellikle &quot;aynı ad soyad&quot; sinyali tek başına kanıt değildir. Emin olduğunuz
          gruplarda <strong>Birleştir</strong> sihirbazını kullanın: ana kaydı seçin, taşınacakların
          özetini görün, onaylayın. <strong>En dolu kayıt</strong> yeşil çerçeveyle işaretli. Aynı
          kişi olmadığından eminseniz <strong>Bu grup mükerrer değil</strong> ile grubu bu cihazda
          gizleyebilirsiniz.
        </span>
      </p>
    </div>
  );
}
