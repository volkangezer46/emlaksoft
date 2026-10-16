import Link from "@/components/ui/smart-link";
import { ArrowLeft, LayoutList } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { requirePlatformModule } from "@/lib/platform";
import { adminNavGroupCatalog } from "@/lib/admin/nav";
import { hubNav, navPageLabelFor } from "@/lib/nav-config";
import { NAV_LAYOUT_BY_KEY, NAV_LAYOUT_KEYS, NAV_LAYOUT_LABELS, REQUIRED_HUB_IDS, pageKey, type HubDef, type NavLayoutKey } from "@/lib/nav-roles";
import { DEFAULT_MATRIX, canAccessModule, type AppModule, type AppRole } from "@/lib/permissions";
import { loadMenuOverrides } from "@/lib/nav-overrides-read";
import { MenuEditor, type EditorHub, type EditorLayout } from "./menu-editor";

export const metadata = { title: "Menü yönetimi" };

/** Önizlemede düzenin temsil rolü (varsayılan yetki matrisiyle; ofisin kendi yetki ve paket kuralları ayrıca uygulanır). */
const PREVIEW_ROLE: Record<NavLayoutKey, AppRole> = { manager: "owner", advisor: "advisor", accounting: "accounting", call_center: "call_center", readonly: "readonly" };

const accessibleOf = (role: AppRole) => (Object.keys(DEFAULT_MATRIX[role]) as AppModule[]).filter((m) => canAccessModule(role, m));

function editorHub(h: HubDef): EditorHub {
  return {
    id: h.id,
    label: h.label,
    group: h.group ?? null,
    required: REQUIRED_HUB_IDS.includes(h.id),
    pages: h.pages.map((pg, i) => ({
      key: pageKey(h.id, pg.href),
      href: pg.href,
      label: pg.label ?? navPageLabelFor(pg.href) ?? pg.href,
      locked: REQUIRED_HUB_IDS.includes(h.id) && i === 0,
    })),
  };
}

/**
 * MENÜ YÖNETİMİ (sahip kararı 2026-10-16: "herşey full adminden yönetilebilir"): ofis paneli yan menüsü rol düzeni
 * bazında (sahip/müdür, danışman, muhasebe, çağrı merkezi, salt okunur) satır ve alt sayfa göster/gizle, grup içi sıra,
 * yeniden adlandırma (varsayılana dön) ve grup gizleme; admin menüsünde grup sırası ve gizleme. Canlı önizleme varsayılan
 * yetki matrisiyle süzülmüş menüyü gösterir. Kayıt tek JSON ayar (platform.nav_menu_overrides; geçmiş + denetim izi).
 * Görüntüleme `sistem` modülü, düzenleme yalnız süper admin.
 */
export default async function AdminMenuPage() {
  const staff = await requirePlatformModule("sistem");
  const overrides = await loadMenuOverrides();

  const layouts: EditorLayout[] = NAV_LAYOUT_KEYS.map((key) => {
    const layout = NAV_LAYOUT_BY_KEY[key];
    const role = PREVIEW_ROLE[key];
    const visible = hubNav(accessibleOf(role), { role });
    const visibleHrefs = [...visible.hubs, ...visible.dock].flatMap((h) => h.pages.map((pg) => pg.href));
    return { key, label: NAV_LAYOUT_LABELS[key], hubs: layout.hubs.map(editorHub), dock: layout.dock.map(editorHub), visibleHrefs };
  });

  return (
    <div className="space-y-6">
      <AdminPageHeader
        art="layers"
        eyebrow="Yönetim"
        icon={LayoutList}
        title="Menü yönetimi"
        description="Ofis paneli menüsünü rol bazında düzenleyin: satır ve alt sayfa göster/gizle, grup içinde sırala, yeniden adlandır. Admin menü gruplarının sırası da buradan. Yalnız görünürlük değişir: yetki ve paket kuralları aynen geçerlidir."
      />
      <MenuEditor layouts={layouts} adminGroups={adminNavGroupCatalog()} initial={overrides} canEdit={staff.role === "super_admin"} />
      <Link href="/admin/ayarlar" className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:underline">
        <ArrowLeft className="h-3 w-3" /> Ayar merkezine dön
      </Link>
    </div>
  );
}
