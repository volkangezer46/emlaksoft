import { Brand } from "@/components/brand/brand";
import { AnnouncementBar } from "@/components/site-menu/announcement-bar";
import { SiteHeaderClient, type ClientGroup } from "@/components/site-menu/mega-menu";
import { now } from "@/lib/clock";
import { renderMenuIcon } from "@/lib/site-menu/icon-node";
import { toPublicMenu } from "@/lib/site-menu/public";
import { getLiveSiteMenu } from "@/lib/site-menu/store";

/**
 * Üst bar (sunucu bileşeni): menü verisi TEK KAYNAKTAN, yani admin'in yayınladığı yapılandırmadan (yoksa varsayılan menü)
 * okunur (unstable_cache + "site-menu" etiketi). İstemciye yalnız hazır JSON ve çizilmiş ikonlar geçer; ikon paketi
 * herkese açık JS'e girmez. Mega menü davranışı: src/components/site-menu/mega-menu.tsx.
 */

/** Daha önce kapatılmış duyuruda ilk boyamadan önce yer kaplamasın diye <html>'e işaret koyar (CLS yok). */
const announcementBoot = (key: string) =>
  `try{if(window.localStorage.getItem("mk-ann-off")===${JSON.stringify(key)})document.documentElement.setAttribute("data-mk-ann-off","1")}catch(e){}`;

export async function SiteHeader() {
  const menu = toPublicMenu(await getLiveSiteMenu(), now());
  const groups: ClientGroup[] = menu.groups.map((g) => ({
    ...g,
    items: g.items.map(({ icon, ...it }) => ({ ...it, iconNode: renderMenuIcon(icon) })),
  }));
  const ann = menu.announcement;

  return (
    <SiteHeaderClient
      groups={groups}
      logo={<Brand variant="horizontal" tone="light" height={34} alt="" />}
      top={
        ann ? (
          <>
            <AnnouncementBar a={ann} />
            <script dangerouslySetInnerHTML={{ __html: announcementBoot(ann.key) }} />
          </>
        ) : undefined
      }
    />
  );
}
