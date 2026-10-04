import {
  Award, Banknote, BadgeCheck, BarChart3, Bell, Bot, Briefcase, Building2, CalendarCheck, CalendarClock, CalendarDays,
  Calculator, ChartNoAxesCombined, CircleHelp, ClipboardCheck, ClipboardList, Clock, Coins, CreditCard, Crosshair, Crown,
  FileSignature, FileText, Files, Flag, Gauge, Globe, Handshake, HeartHandshake, House, Inbox, Info, KeyRound, Landmark,
  Layers, LayoutDashboard, LifeBuoy, Link2, ListChecks, Lock, Mail, MapPin, MapPinned, Medal, MessageSquare,
  MessageSquareText, MessagesSquare, Network, Percent, Phone, PiggyBank, Presentation, RadioTower, Receipt, Rocket, Route,
  Scale, ScrollText, Search, Send, Settings, ShieldAlert, ShieldCheck, Siren, Smile, Sparkles, Store, Tag, Target,
  TrendingUp, Trophy, UserRound, Users, UsersRound, Wallet, Workflow, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Site menüsü için KONTROLLÜ ikon listesi (yönetici yalnız buradan seçer; serbest ad yok).
 * Her kayıt: Türkçe etiket + arama anahtar sözcükleri. Sunucuda doğrulama ve çizim bu tek tablodan yapılır.
 * Yalnız sunucu bileşeni (SiteHeader) ve admin editörü içe aktarır; herkese açık istemci paketine girmez.
 */
type Def = { Icon: LucideIcon; label: string; keywords: string };

const DEFS = {
  Award: { Icon: Award, label: "Ödül", keywords: "başarı rozet" },
  Banknote: { Icon: Banknote, label: "Banknot", keywords: "para nakit" },
  BadgeCheck: { Icon: BadgeCheck, label: "Onay rozeti", keywords: "doğrulama tik" },
  BarChart3: { Icon: BarChart3, label: "Çubuk grafik", keywords: "rapor analiz" },
  Bell: { Icon: Bell, label: "Zil", keywords: "bildirim uyarı" },
  Bot: { Icon: Bot, label: "Robot", keywords: "yapay zeka asistan ai" },
  Briefcase: { Icon: Briefcase, label: "Çanta", keywords: "iş ekip profesyonel" },
  Building2: { Icon: Building2, label: "Bina", keywords: "ofis portföy emlak" },
  CalendarCheck: { Icon: CalendarCheck, label: "Takvim onay", keywords: "randevu demo" },
  CalendarClock: { Icon: CalendarClock, label: "Takvim saat", keywords: "randevu plan" },
  CalendarDays: { Icon: CalendarDays, label: "Takvim", keywords: "gün tarih" },
  Calculator: { Icon: Calculator, label: "Hesap makinesi", keywords: "değerleme hesaplama" },
  ChartNoAxesCombined: { Icon: ChartNoAxesCombined, label: "Büyüme grafiği", keywords: "performans satış" },
  CircleHelp: { Icon: CircleHelp, label: "Soru işareti", keywords: "sss yardım" },
  ClipboardCheck: { Icon: ClipboardCheck, label: "Kontrol listesi", keywords: "görev onay" },
  ClipboardList: { Icon: ClipboardList, label: "Liste panosu", keywords: "görev kayıt" },
  Clock: { Icon: Clock, label: "Saat", keywords: "zaman süre" },
  Coins: { Icon: Coins, label: "Bozuk para", keywords: "komisyon para" },
  CreditCard: { Icon: CreditCard, label: "Kredi kartı", keywords: "ödeme fatura" },
  Crosshair: { Icon: Crosshair, label: "Nişan", keywords: "talep hedef" },
  Crown: { Icon: Crown, label: "Taç", keywords: "kurumsal premium" },
  FileSignature: { Icon: FileSignature, label: "İmzalı belge", keywords: "sözleşme imza" },
  FileText: { Icon: FileText, label: "Belge", keywords: "metin doküman" },
  Files: { Icon: Files, label: "Belgeler", keywords: "dosyalar evrak" },
  Flag: { Icon: Flag, label: "Bayrak", keywords: "işaret hedef" },
  Gauge: { Icon: Gauge, label: "Gösterge", keywords: "hız ölçüm" },
  Globe: { Icon: Globe, label: "Küre", keywords: "vitrin web internet" },
  Handshake: { Icon: Handshake, label: "El sıkışma", keywords: "anlaşma ortaklık" },
  HeartHandshake: { Icon: HeartHandshake, label: "Güven eli", keywords: "müşteri ilişki" },
  House: { Icon: House, label: "Ev", keywords: "konut ana sayfa emlak" },
  Inbox: { Icon: Inbox, label: "Gelen kutusu", keywords: "başvuru mesaj" },
  Info: { Icon: Info, label: "Bilgi", keywords: "açıklama" },
  KeyRound: { Icon: KeyRound, label: "Anahtar", keywords: "kiralama erişim" },
  Landmark: { Icon: Landmark, label: "Kamu binası", keywords: "tapu resmi" },
  Layers: { Icon: Layers, label: "Katmanlar", keywords: "paket seviye" },
  LayoutDashboard: { Icon: LayoutDashboard, label: "Pano", keywords: "panel ürün turu" },
  LifeBuoy: { Icon: LifeBuoy, label: "Can simidi", keywords: "destek yardım" },
  Link2: { Icon: Link2, label: "Bağlantı", keywords: "link portal" },
  ListChecks: { Icon: ListChecks, label: "Yapılacaklar", keywords: "görev liste" },
  Lock: { Icon: Lock, label: "Kilit", keywords: "güvenlik gizlilik kvkk" },
  Mail: { Icon: Mail, label: "Zarf", keywords: "e-posta iletişim" },
  MapPin: { Icon: MapPin, label: "Konum", keywords: "harita adres" },
  MapPinned: { Icon: MapPinned, label: "İşaretli harita", keywords: "bölge mahalle" },
  Medal: { Icon: Medal, label: "Madalya", keywords: "başarı derece" },
  MessageSquare: { Icon: MessageSquare, label: "Mesaj", keywords: "sohbet iletişim" },
  MessageSquareText: { Icon: MessageSquareText, label: "Metin mesajı", keywords: "sms not" },
  MessagesSquare: { Icon: MessagesSquare, label: "Konuşmalar", keywords: "topluluk görüşme" },
  Network: { Icon: Network, label: "Ağ", keywords: "şube yapı entegrasyon" },
  Percent: { Icon: Percent, label: "Yüzde", keywords: "oran indirim" },
  Phone: { Icon: Phone, label: "Telefon", keywords: "arama iletişim" },
  PiggyBank: { Icon: PiggyBank, label: "Kumbara", keywords: "tasarruf kâr" },
  Presentation: { Icon: Presentation, label: "Sunum", keywords: "tanıtım demo" },
  RadioTower: { Icon: RadioTower, label: "Verici", keywords: "yayın takip" },
  Receipt: { Icon: Receipt, label: "Makbuz", keywords: "fatura" },
  Rocket: { Icon: Rocket, label: "Roket", keywords: "başlangıç hız" },
  Route: { Icon: Route, label: "Rota", keywords: "adım yol nasıl" },
  Scale: { Icon: Scale, label: "Terazi", keywords: "yasal hukuk kvkk" },
  ScrollText: { Icon: ScrollText, label: "Parşömen", keywords: "metin şartlar" },
  Search: { Icon: Search, label: "Arama", keywords: "bul" },
  Send: { Icon: Send, label: "Gönder", keywords: "mesaj kağıt uçak" },
  Settings: { Icon: Settings, label: "Ayarlar", keywords: "dişli yapılandırma" },
  ShieldAlert: { Icon: ShieldAlert, label: "Uyarı kalkanı", keywords: "kayıp kaçak koruma" },
  ShieldCheck: { Icon: ShieldCheck, label: "Onaylı kalkan", keywords: "güvenli" },
  Siren: { Icon: Siren, label: "Siren", keywords: "acil uyarı" },
  Smile: { Icon: Smile, label: "Gülen yüz", keywords: "memnuniyet" },
  Sparkles: { Icon: Sparkles, label: "Parıltı", keywords: "yeni ai" },
  Store: { Icon: Store, label: "Dükkân", keywords: "vitrin mağaza" },
  Tag: { Icon: Tag, label: "Etiket", keywords: "fiyat" },
  Target: { Icon: Target, label: "Hedef", keywords: "talep" },
  TrendingUp: { Icon: TrendingUp, label: "Yükselen trend", keywords: "büyüme artış" },
  Trophy: { Icon: Trophy, label: "Kupa", keywords: "birincilik" },
  UserRound: { Icon: UserRound, label: "Kişi", keywords: "danışman kullanıcı" },
  Users: { Icon: Users, label: "Kişiler", keywords: "müşteri ekip" },
  UsersRound: { Icon: UsersRound, label: "Ekip", keywords: "grup takım" },
  Wallet: { Icon: Wallet, label: "Cüzdan", keywords: "bütçe ödeme" },
  Workflow: { Icon: Workflow, label: "İş akışı", keywords: "otomasyon süreç" },
  Wrench: { Icon: Wrench, label: "Anahtar takımı", keywords: "araç bakım" },
  Zap: { Icon: Zap, label: "Şimşek", keywords: "hızlı enerji" },
} satisfies Record<string, Def>;

export type MenuIconName = keyof typeof DEFS;

export const MENU_ICON_LIST: ReadonlyArray<{ name: MenuIconName; label: string; keywords: string }> = (
  Object.keys(DEFS) as MenuIconName[]
).map((name) => ({ name, label: DEFS[name].label, keywords: DEFS[name].keywords }));

export function isMenuIconName(value: string): value is MenuIconName {
  return Object.prototype.hasOwnProperty.call(DEFS, value);
}

export function menuIconComponent(name: string): LucideIcon | null {
  return isMenuIconName(name) ? DEFS[name].Icon : null;
}
