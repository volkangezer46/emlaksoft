/**
 * İlk boyamadan önce kayıtlı yan menü daraltma tercihini uygular (sunucu bileşeni;
 * `es-sidebar` anahtarı sidebar-collapse.tsx ile aynı). <html> suppressHydrationWarning'lidir.
 */
const SCRIPT = `try{if(localStorage.getItem("es-sidebar")==="collapsed")document.documentElement.setAttribute("data-sidebar","collapsed")}catch(e){}`;

export function SidebarBoot() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
