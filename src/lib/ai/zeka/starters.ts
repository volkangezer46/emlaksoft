import type { ZekaSurface } from "./types";

/**
 * Sayfaya ve role göre BAŞLANGIÇ SORULARI (SAF, bağımlılıksız; tembel Zeka paneliyle iner). Yüzen "Zeka'ya sor"
 * düğmesi bulunduğu yolu (`usePathname`) verir: /app/portfoyler'de portföy soruları, /admin/destek'te destek soruları...
 * Her soru motorların GERÇEKTEN yanıtladığı kalıptadır (zeka-nlu testleri); yönetim sorusu (ciro, danışman sıralaması)
 * yalnız o veriyi görebilen rollere önerilir (rolün göremeyeceği soruyu önermek "yetkiniz yok" yanıtına götürür).
 */

type Starter = { q: string; mgr?: boolean };
type Rule = { prefix: string; topic: string; items: readonly Starter[] };

/** Ofis geneli tutar/performans görebilen roller (scope.ts `earningsAll`/`officeWide` ile uyumlu varsayılanlar). */
const MANAGER_ROLES = new Set(["owner", "gm", "branch_manager", "accounting"]);

const APP_RULES: readonly Rule[] = [
  { prefix: "/app/portfoyler", topic: "Portföyler", items: [{ q: "Kaç portföyümüz var?" }, { q: "Kadıköy'de 3+1 satılık portföyler" }, { q: "Portföy nasıl yayına alınır?" }, { q: "Yeni portföy ekle" }] },
  { prefix: "/app/portfoy-avi", topic: "Sahibinden ilanlar", items: [{ q: "Sahibinden ilanlar nerede?" }, { q: "Kaç portföyümüz var?" }, { q: "Portföy nasıl eklenir?" }] },
  { prefix: "/app/musteriler", topic: "Müşteriler", items: [{ q: "Bu ay kaç yeni müşteri eklendi?" }, { q: "Müşteri nasıl eklenir?" }, { q: "Yeni müşteri ekle" }, { q: "Yarın 10:00 randevu" }] },
  { prefix: "/app/talepler", topic: "Talepler", items: [{ q: "Kaç açık talep var?" }, { q: "Talep eşleşmesi nasıl çalışır?" }, { q: "Yeni talep oluştur" }] },
  { prefix: "/app/ilan-havuzu", topic: "Havuz ve atama", items: [{ q: "Kaç açık talep var?" }, { q: "Talep nasıl atanır?" }] },
  { prefix: "/app/randevular", topic: "Randevular", items: [{ q: "Bugün kaç randevum var?" }, { q: "Yarın kaç randevu var?" }, { q: "Yarın 14:00 randevu oluştur" }] },
  { prefix: "/app/gorevler", topic: "Görevler", items: [{ q: "Geciken görevler kaç?" }, { q: "Bugünkü görevlerim" }, { q: "Yeni görev oluştur" }] },
  { prefix: "/app/anlasmalar", topic: "Anlaşmalar", items: [{ q: "Bu ay kaç satış yaptık?" }, { q: "Açık anlaşmalar kaç?" }, { q: "En çok satış yapan danışman kim?", mgr: true }, { q: "Geçen ay kaç satış yaptık?" }] },
  { prefix: "/app/teklifler", topic: "Teklifler", items: [{ q: "Açık teklifler kaç?" }, { q: "Teklif nasıl hazırlanır?" }, { q: "Yeni teklif oluştur" }] },
  { prefix: "/app/sozlesmeler", topic: "Sözleşmeler", items: [{ q: "Aktif sözleşmeler kaç?" }, { q: "Sözleşme nasıl hazırlanır?" }] },
  { prefix: "/app/performansim", topic: "Performansım", items: [{ q: "Bu ay kaç satış yaptım?" }, { q: "Bugün kaç randevum var?" }] },
  { prefix: "/app/finans/komisyon", topic: "Komisyon", items: [{ q: "Bekleyen komisyonlar" }, { q: "Komisyon nasıl hesaplanır?" }, { q: "Bu ay ciro ne kadar?", mgr: true }] },
  { prefix: "/app/kazancim", topic: "Kazancım", items: [{ q: "Bu ay kaç satış yaptım?" }, { q: "Komisyon nasıl hesaplanır?" }] },
  { prefix: "/app/finans", topic: "Muhasebe", items: [{ q: "Bu ay ciro ne kadar?", mgr: true }, { q: "Gelir gider kaydı nasıl eklenir?" }, { q: "Geciken kiralar" }] },
  { prefix: "/app/kiralama", topic: "Mülk yönetimi", items: [{ q: "Geciken kiralar" }, { q: "Aktif kira sayısı" }, { q: "Aidat nasıl takip edilir?" }] },
  { prefix: "/app/ekip", topic: "Ekibim", items: [{ q: "En çok satış yapan danışman kim?", mgr: true }, { q: "Yeni danışman nasıl eklenir?" }, { q: "Yetkiler nerede?" }] },
  { prefix: "/app/raporlar", topic: "Raporlar", items: [{ q: "Bu ay kaç satış yaptık?" }, { q: "Satış raporu" }, { q: "Bu ay ciro ne kadar?", mgr: true }] },
  { prefix: "/app/ayarlar", topic: "Ayarlar", items: [{ q: "Yetkiler nerede?" }, { q: "Vitrin nasıl açılır?" }, { q: "Kullanıcı nasıl eklenir?" }] },
  { prefix: "/app/yardim", topic: "Yardım", items: [{ q: "Müşteri nasıl eklenir?" }, { q: "Portföy nasıl yayına alınır?" }, { q: "Destek talebi nasıl açılır?" }] },
];
const APP_DEFAULT: readonly Starter[] = [{ q: "Bugün kaç randevum var?" }, { q: "Geciken görevler kaç?" }, { q: "Bu ay kaç satış yaptık?" }, { q: "Müşteri nasıl eklenir?" }];

const ADMIN_RULES: readonly Rule[] = [
  { prefix: "/admin/tenants", topic: "Ofisler", items: [{ q: "Kaç aktif ofis var?" }, { q: "Deneme sürecindeki ofisler" }, { q: "Yeni ofis nasıl açılır?" }] },
  { prefix: "/admin/tickets", topic: "Destek", items: [{ q: "Açık destek talebi kaç?" }, { q: "Acil destek talepleri" }] },
  { prefix: "/admin/billing", topic: "Gelir", items: [{ q: "MRR ne kadar?" }, { q: "Kaç aktif ofis var?" }, { q: "Paket fiyatları nerede?" }] },
  { prefix: "/admin/zeka", topic: "Yapay zeka", items: [{ q: "OpenAI anahtarı nereye girilir?" }, { q: "Zeka nasıl eğitilir?" }, { q: "AI kullanımı nerede?" }] },
  { prefix: "/admin/ayarlar", topic: "Ayarlar", items: [{ q: "Özellik bayrakları nerede?" }, { q: "Deneme süresi ayarı" }, { q: "E-posta şablonları" }] },
  { prefix: "/admin/sistem", topic: "Sistem", items: [{ q: "Hata kayıtları" }, { q: "Entegrasyonlar" }, { q: "Kuyruklar" }] },
];
const ADMIN_DEFAULT: readonly Starter[] = [{ q: "Kaç aktif ofis var?" }, { q: "MRR ne kadar?" }, { q: "Açık destek talebi kaç?" }, { q: "Ofis ara" }];

const PUBLIC_RULES: readonly Rule[] = [
  { prefix: "/fiyatlar", topic: "Fiyatlar", items: [{ q: "Paketler ve fiyatlar neler?" }, { q: "Deneme süresi kaç gün?" }, { q: "Hangi paket bana uygun?" }, { q: "Yıllık ödemede indirim var mı?" }] },
  { prefix: "/rehber", topic: "Rehber", items: [{ q: "Portföy nasıl yayına alınır?" }, { q: "Müşteri takibi nasıl yapılır?" }, { q: "KVKK'ya uygun mu?" }] },
  { prefix: "/araclar", topic: "Araçlar", items: [{ q: "Kira artışı nasıl hesaplanır?" }, { q: "Hangi araçlar var?" }, { q: "Deneme süresi kaç gün?" }] },
];
const PUBLIC_DEFAULT: readonly Starter[] = [{ q: "Paketler ve fiyatlar neler?" }, { q: "Deneme süresi kaç gün?" }, { q: "Portföyleri portallara aktarabilir miyim?" }, { q: "KVKK'ya uygun mu?" }];

const VITRIN_DEFAULT: readonly Starter[] = [{ q: "3+1 satılık daireler" }, { q: "Kiralık ilanlar" }, { q: "10 milyon altı evler" }, { q: "Yer göstermesi istiyorum" }];

export type ZekaStarterSet = { topic: string | null; items: string[] };

function pick(rules: readonly Rule[], fallback: readonly Starter[], path: string): { topic: string | null; items: readonly Starter[] } {
  // En uzun eşleşen önek kazanır (/app/finans/hareketler → Muhasebe).
  let best: Rule | null = null;
  for (const r of rules) if ((path === r.prefix || path.startsWith(`${r.prefix}/`)) && (!best || r.prefix.length > best.prefix.length)) best = r;
  return best ? { topic: best.topic, items: best.items } : { topic: null, items: fallback };
}

/** Yüzey + yol + rol için en çok 4 başlangıç sorusu. Rol bilinmiyorsa yönetim soruları önerilmez. */
export function zekaStarters(surface: ZekaSurface, path: string | null | undefined, role?: string | null): ZekaStarterSet {
  const p = (path ?? "/").split(/[?#]/)[0] || "/";
  const set =
    surface === "app" ? pick(APP_RULES, APP_DEFAULT, p) : surface === "admin" ? pick(ADMIN_RULES, ADMIN_DEFAULT, p) : surface === "vitrin" ? { topic: null, items: VITRIN_DEFAULT } : pick(PUBLIC_RULES, PUBLIC_DEFAULT, p);
  const manager = surface !== "app" || (role ? MANAGER_ROLES.has(role) : false);
  return { topic: set.topic, items: set.items.filter((s) => !s.mgr || manager).map((s) => s.q).slice(0, 4) };
}
