import { BellRing, ChartNoAxesColumn, Rocket, ShieldCheck, Users } from "lucide-react";

/** Beş değer kartı: yalnız gerçek ürün davranışına dayanır (kurulum sihirbazı, rol matrisi, kayıp-kaçak, RLS, cron). */
const CARDS = [
  { icon: Rocket, tint: "mint", title: "Adım adım kurulum", text: "Kurulum sihirbazı ofisinizi, ekibinizi ve ilk verilerinizi sırayla hazırlar.", href: "#nasil" },
  { icon: Users, tint: "violet", title: "Rol ve izin kontrolü", text: "Danışman, muhasebe ve yönetici erişimi ayrı ayrı tanımlanır.", href: "#guvenlik" },
  { icon: ChartNoAxesColumn, tint: "amber", title: "Kaçan komisyonu ölçün", text: "Zorunlu kapanış formu ve danışman bazında kaçak karnesi.", href: "#kayip-kacak" },
  { icon: ShieldCheck, tint: "blue", title: "Ofis verisi ayrı tutulur", text: "Satır düzeyinde güvenlik; ana veritabanı Frankfurt bölgesinde.", href: "#guvenlik" },
  { icon: BellRing, tint: "rose", title: "Arka planda çalışan görevler", text: "Hatırlatma, teyit ve özet işleri 27 otomatik görevle yürür.", href: "#ozellikler" },
] as const;

export function ValueCards() {
  return (
    <section aria-label="Öne çıkan değerler" className="mk-wrap mk-values-wrap">
      <ul className="mk-values">
        {CARDS.map((c) => (
          <li key={c.title}>
            <a href={c.href} className="mk-value">
              <span className={`mk-value-ico mk-tint-${c.tint}`}><c.icon size={24} aria-hidden="true" /></span>
              <span>
                <b>{c.title}</b>
                <small>{c.text}</small>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
