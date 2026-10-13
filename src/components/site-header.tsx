import { Brand } from "@/components/brand/brand";
import { toClientGroups } from "@/components/site-menu/client-groups";
import { SiteHeaderClient } from "@/components/site-menu/mega-menu";
import { SpeculationRules } from "@/components/marketing/speculation-rules";
import { now } from "@/lib/clock";
import { customCtas, toPublicMenu } from "@/lib/site-menu/public";
import { getLiveSiteMenu } from "@/lib/site-menu/store";

/**
 * Üst bar (sunucu bileşeni): menü verisi TEK KAYNAKTAN, yani admin'in yayınladığı yapılandırmadan (yoksa varsayılan menü)
 * okunur (unstable_cache + "site-menu" etiketi). İstemciye yalnız hazır JSON, çizilmiş ikonlar ve önizleme sahneleri geçer; ikon paketi
 * herkese açık JS'e girmez. Mega menü davranışı: src/components/site-menu/mega-menu.tsx. Duyuru seçimi (yol, tarih, öncelik,
 * kapatma) istemci bileşeninde saf `pickAnnouncement` ile yapılır; buradan yalnız adaylar ve çizim anı geçer.
 */

/**
 * Daha önce kapatılmış duyuruda ilk boyamadan önce yer kaplamasın diye <html>'e işaret koyar (CLS yok). Şeritten hemen
 * sonra durur; anahtarı şeridin `data-key` özniteliğinden okur (hangi duyurunun seçildiği yola bağlıdır).
 */
const ANNOUNCEMENT_BOOT =
  'try{var b=document.currentScript&&document.currentScript.previousElementSibling,k=b&&b.getAttribute("data-key"),v=" "+(window.localStorage.getItem("mk-ann-off")||"")+" ";if(k&&v.indexOf(" "+k+" ")>-1)document.documentElement.setAttribute("data-mk-ann-off","1")}catch(e){}';

export async function SiteHeader() {
  const cfg = await getLiveSiteMenu();
  const at = now();
  const menu = toPublicMenu(cfg, at);
  const groups = toClientGroups(menu);
  const ctas = customCtas(cfg.ctas);
  // Varsayılan yayında (duyuru yok, düğmeler bugünkü) istemci bileşenine bugünkü proplar dışında bir şey geçmez.
  const extra = {
    ...(menu.announcements.length
      ? { announcements: menu.announcements, annAt: at, annBoot: <script dangerouslySetInnerHTML={{ __html: ANNOUNCEMENT_BOOT }} /> }
      : {}),
    ...(ctas ? { ctas } : {}),
  };

  return (
    <>
    <SpeculationRules />
    <SiteHeaderClient
      groups={groups}
      logo={<Brand variant="horizontal" tone="light" height={34} alt="" />}
      top={undefined}
      {...extra}
    />
    </>
  );
}
