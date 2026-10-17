import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Building2,
  ClipboardCheck,
  CreditCard,
  Database,
  FileText,
  Flag,
  Gauge,
  Globe,
  HeartPulse,
  Inbox,
  KeyRound,
  LayoutDashboard,
  Link2,
  ListChecks,
  MapPin,
  Megaphone,
  MessageSquareText,
  Palette,
  Plug,
  Receipt,
  Rocket,
  Scale,
  Search,
  Settings,
  ShieldCheck,
  Siren,
  Sparkles,
  Tag,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

/**
 * /admin bölüm sekmesi ikonları (görsel katman; menü İÇERİĞİ `nav.ts`'tedir ve burası ona dokunmaz).
 * Sekme yolu (ve `?sekme=`) → ikon. Bilinmeyen sekme menü öğesinin kendi ikonunu alır (`adminTabIcon` fallback):
 * yani her sekme ikonludur (icon-contract testi). Ortak sözlükteki kavram ikonlarıyla aynı metafor (müşteri = Users,
 * rapor = BarChart3, ayar = Settings ...). Yalnız sekme şeridi (istemci) kullanır; ~35 ikon, ağaç sallanır.
 */
const BY_HREF: Record<string, LucideIcon> = {
  "/admin": LayoutDashboard,
  "/admin/raporlar": BarChart3,
  "/admin/raporlar?sekme=merkez": FileText,
  "/admin/danisman": Sparkles,
  "/admin/onaylar": ClipboardCheck,
  "/admin/tenants": Building2,
  "/admin/members": Users,
  "/admin/tenants/kurulum": Rocket,
  "/admin/gorevler": ListChecks,
  "/admin/billing": CreditCard,
  "/admin/billing/planlar": Tag,
  "/admin/billing/kuponlar": Tag,
  "/admin/billing/tahsilat": Wallet,
  "/admin/billing/muhasebe": Scale,
  "/admin/billing/defter": Receipt,
  "/admin/billing/kanal-roi": Gauge,
  "/admin/ai-kullanim": Bot,
  "/admin/zeka": Plug,
  "/admin/zeka?sekme=yuzeyler": LayoutDashboard,
  "/admin/zeka?sekme=davranis": MessageSquareText,
  "/admin/zeka?sekme=bilgi": BookOpen,
  "/admin/zeka?sekme=kullanim": BarChart3,
  "/admin/zeka?sekme=kayitlar": FileText,
  "/admin/analiz-tarifesi": Receipt,
  "/admin/aktivite": Activity,
  "/admin/bildirimler": Bell,
  "/admin/duyuru?sekme=nps": MessageSquareText,
  "/admin/ayarlar": Settings,
  "/admin/ayarlar/bayraklar": Flag,
  "/admin/ayarlar/eposta": Inbox,
  "/admin/ayarlar/tufe": BarChart3,
  "/admin/ayarlar/yasal": Scale,
  "/admin/geo": MapPin,
  "/admin/geo/eslestir": Link2,
  "/admin/geo/ice-aktar": Database,
  "/admin/geo/kullanim": BarChart3,
  "/admin/geo/saglik": HeartPulse,
  "/admin/geo/surumler": Activity,
  "/admin/geo/talepler": Inbox,
  "/admin/hesabim": UserRound,
  "/admin/personel": Users,
  "/admin/personel/roller": KeyRound,
  "/admin/personel/guvenlik": ShieldCheck,
  "/admin/sistem": HeartPulse,
  "/admin/sistem?sekme=durum": Gauge,
  "/admin/sistem?sekme=entegrasyonlar": Plug,
  "/admin/sistem?sekme=hatalar": Siren,
  "/admin/sistem?sekme=kaynaklar": Gauge,
  "/admin/sistem?sekme=uyarilar": Bell,
  "/admin/sistem?sekme=veritabani": Database,
  "/admin/sistem?sekme=veri": Search,
  "/admin/site": Globe,
  "/admin/site/baglantilar": Link2,
  "/admin/site/hiz": Gauge,
  "/admin/site/marka": Palette,
  "/admin/site/medya": FileText,
  "/admin/site/menu": ListChecks,
  "/admin/site/rehber": BookOpen,
  "/admin/site/reklam": Megaphone,
  "/admin/site/reklam/google": Megaphone,
  "/admin/site/sayfalar": FileText,
  "/admin/site/seo": Search,
  "/admin/tickets": Inbox,
  "/admin/tickets/ayarlar": Settings,
  "/admin/tickets/kvkk": ShieldCheck,
  "/admin/tickets/makrolar": MessageSquareText,
  "/admin/tickets/oneriler": Sparkles,
  "/admin/tickets/raporlar": BarChart3,
  "/admin/tickets/yardim": BookOpen,
};

/** Sekme ikonu: önce tam yol (+ `?sekme=`), sonra en uzun ön ek, yoksa menü öğesinin ikonu. */
export function adminTabIcon(href: string, fallback: LucideIcon): LucideIcon {
  const hit = BY_HREF[href];
  if (hit) return hit;
  const path = href.split("?")[0]!;
  let best: LucideIcon | null = null;
  let len = 0;
  for (const [k, v] of Object.entries(BY_HREF)) {
    if (!k.includes("?") && (path === k || path.startsWith(`${k}/`)) && k.length > len) {
      best = v;
      len = k.length;
    }
  }
  return best ?? fallback;
}

/** Sözleşme testi için: tanımlı eşlemeler. */
export const ADMIN_TAB_ICON_HREFS = Object.keys(BY_HREF);
