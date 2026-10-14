/**
 * İlk boyamadan önce kayıtlı yan menü daraltma tercihini uygular (sunucu bileşeni;
 * `es-sidebar` anahtarı sidebar-collapse.tsx ile aynı). <html> suppressHydrationWarning'lidir.
 * CSP rapor modu bu metnin özetini taşır (src/lib/security/csp-report-only.ts INLINE_SCRIPT_HASHES).
 */
export const SIDEBAR_BOOT_SCRIPT = `try{if(localStorage.getItem("es-sidebar")==="collapsed")document.documentElement.setAttribute("data-sidebar","collapsed")}catch(e){}`;

export function SidebarBoot() {
  return <script dangerouslySetInnerHTML={{ __html: SIDEBAR_BOOT_SCRIPT }} />;
}
