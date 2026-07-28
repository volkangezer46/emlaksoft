/**
 * İKONOGRAFİ SÖZLÜĞÜ — kavram → lucide ikonu.
 *
 * NEDEN: aynı kavram ekrandan ekrana farklı ikonla çizilince kullanıcı her
 * sayfada haritayı yeniden öğrenmek zorunda kalıyor. Tarama sonucu tespit
 * edilen çakışmalar (kullanım adedi ile):
 *
 *   müşteri   → Users (75) · UserRound (33) · User (19) · Users2 (12)
 *   portföy   → Building2 (129) · Home (15) · Store (2)
 *   randevu   → CalendarDays (42) · CalendarClock (41) · Calendar (7) · CalendarCheck (2)
 *   talep     → Target (36) · Crosshair (22)
 *   görev     → ListChecks (23) · CheckSquare (7) · ClipboardCheck (2)
 *   rapor     → BarChart3 (25) · PieChart (13) · LineChart (6)
 *   ayar      → Settings (8) · Settings2 (4)
 *   anahtar   → KeyRound (30) · Key (1)
 *
 * KURAL: Yeni ekran yazarken kavramsal ikonu BURADAN al (`ICONS.musteri`).
 * Doğrudan lucide'den import etmek yalnızca kavramsal olmayan, tek seferlik
 * süsler için (ör. ok, çarpı, chevron) serbesttir.
 *
 * Seçim gerekçesi kısaca: en yaygın kullanılan varyant kazandı — böylece
 * düzeltme maliyeti (ve regresyon riski) en düşük oldu.
 */
import {
  Award,
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  Clock,
  Coins,
  CreditCard,
  Crosshair,
  DoorOpen,
  FileSignature,
  FileText,
  Gauge,
  Handshake,
  HeartHandshake,
  Inbox,
  KeyRound,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Mail,
  MapPin,
  MapPinned,
  MessageSquare,
  Network,
  Percent,
  Phone,
  PiggyBank,
  RadioTower,
  Receipt,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  Siren,
  Sparkles,
  Store,
  Tag,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserRound,
  Users,
  UsersRound,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";

/** Sözlükteki kavram anahtarları — otomatik tamamlama ve tip güvenliği için. */
export type IconConcept = keyof typeof ICONS;

export const ICONS = {
  // --- Çekirdek varlıklar ---------------------------------------------------
  /** Müşteri / kişi kaydı. TEK doğru: Users (UserRound/User/Users2 DEĞİL). */
  musteri: Users,
  /** Ekip / danışman grubu — müşteriden ayrışsın diye UsersRound. */
  ekip: UsersRound,
  /** TEK danışman / atanan kişi. UserRound'un MEŞRU kullanımı buradadır;
   *  müşteri anlatmak için kullanılması tutarsızlıktır. */
  danisman: UserRound,
  /** Şube / franchise ofisi — portföy binası (Building2) ile karışmasın. */
  sube: Store,
  /** Portföy / gayrimenkul ilanı. TEK doğru: Building2 (Home/Store DEĞİL). */
  portfoy: Building2,
  /** Alıcı/kiracı talebi. TEK doğru: Target (Crosshair eşleştirmeye ayrıldı). */
  talep: Target,
  /** Talep-portföy eşleştirme motoru — nişan alma metaforu. */
  eslestirme: Crosshair,
  /** Randevu / takvim. TEK doğru: CalendarDays (CalendarClock yalnız "saatli
   *  hatırlatma" bağlamında, ör. gecikmiş görev saati). */
  randevu: CalendarDays,
  /** Görev / yapılacak. TEK doğru: ListChecks (CheckSquare DEĞİL). */
  gorev: ListChecks,
  /** Anlaşma / el sıkışma. */
  anlasma: Handshake,
  /** Sözleşme / imzalı evrak. */
  sozlesme: FileSignature,
  /** Teklif. */
  teklif: Tag,
  /** Gelen kutusu (form/portal başvuruları). */
  gelenKutusu: Inbox,

  // --- Finans ---------------------------------------------------------------
  /** Komisyon / hakediş. */
  komisyon: Wallet,
  /** Danışmanın kendi cüzdanı. */
  cuzdan: PiggyBank,
  /** Gider / fiş. */
  gider: Receipt,
  /** Aidat / dönemsel tahsilat. */
  aidat: Coins,
  /** Abonelik / ödeme yöntemi. */
  abonelik: CreditCard,
  /** Oran / yüzde (kira artışı, komisyon oranı). */
  oran: Percent,

  // --- Analiz ---------------------------------------------------------------
  /** Rapor. TEK doğru: BarChart3 (PieChart/LineChart yalnız grafik türünü
   *  anlatan yerel bağlamda). */
  rapor: BarChart3,
  /** Hedef takibi (dönemsel hedef/gerçekleşme). */
  hedef: TrendingUp,
  /** Düşüş / kayıp metriği. */
  dusus: TrendingDown,
  /** Danışman KPI / başarı sıralaması. */
  kpi: Trophy,
  /** Rozet / ödül. */
  rozet: Award,
  /** Bölge analizi / harita üzerinde konum kümesi. */
  bolge: MapPinned,
  /** Tekil konum. */
  konum: MapPin,
  /** Ofis skoru / sağlık göstergesi. */
  skor: Gauge,
  /** Kayıp-kaçak alarmı. */
  alarm: Siren,

  // --- Operasyon ------------------------------------------------------------
  /** Ana ekran. */
  dashboard: LayoutDashboard,
  /** AI asistan / akıllı öneri. */
  ai: Sparkles,
  /** Arama (telefon görüşmesi). */
  telefon: Phone,
  /** E-posta. */
  eposta: Mail,
  /** Mesaj / kampanya gönderimi. */
  mesaj: MessageSquare,
  /** Bildirim. */
  bildirim: Bell,
  /** Arama kutusu (filtre/sorgu). */
  arama: Search,
  /** Zaman / süre. */
  zaman: Clock,
  /** Anahtar teslim / anahtar kaydı. TEK doğru: KeyRound. */
  anahtar: KeyRound,
  /** Açık ev etkinliği. */
  acikEv: DoorOpen,
  /** Portal yayını. */
  portal: RadioTower,
  /** Ofisler arası ağ / paylaşım. */
  ag: Network,
  /** Proje (çok birimli). */
  proje: Layers,
  /** Tavsiye / referans zinciri. */
  tavsiye: HeartHandshake,
  /** Otomasyon / tetikleyici. */
  otomasyon: Zap,
  /** Belge / genel evrak. */
  belge: FileText,
  /** Denetim kaydı. */
  denetim: ScrollText,
  /** Uyum / güvenlik. */
  uyum: ShieldCheck,
  /** Destek. */
  destek: LifeBuoy,
  /** Ayarlar. TEK doğru: Settings (Settings2 DEĞİL). */
  ayar: Settings,
} satisfies Record<string, LucideIcon>;

/**
 * Kavram anahtarından ikon döndürür; bilinmeyen anahtarda güvenli varsayılan.
 * Dinamik (veriden gelen) anahtarlar için — statik kullanımda `ICONS.x` yeterli.
 */
export function iconFor(concept: string, fallback: LucideIcon = FileText): LucideIcon {
  return (ICONS as Record<string, LucideIcon>)[concept] ?? fallback;
}
