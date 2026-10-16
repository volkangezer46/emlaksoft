import type { ReactNode } from "react";
import { ListHero, ListPage } from "@/components/ui/list-page";
import { effectiveCanAccessModule, effectiveHasPermission } from "@/lib/permissions-effective";
import { requireModulePage } from "@/lib/require-module-page";
import { FINANCE_HERO_TEXT, FinanceActions } from "./_tabs/finance-shell";

/**
 * Finans merkezi kabuğu (WP6): tek başlık + ayrı "Gelir ekle" / "Gider ekle" eylemleri (P2 15); alt alanlar gerçek yollardır (`/app/finans/<bölüm>`) ve
 * sekme şeridi menü merkezinin şerididir (nav-roles "Finans"). Asıl kapı her alt sayfadadır (`expenses` ya da
 * Komisyon/Hakediş için `commissions`); burada yalnız oturum açık kullanıcının izinleri okunur (istek içi önbellek).
 */
export default async function FinanceLayout({ children }: { children: ReactNode }) {
  const { perms } = await requireModulePage("dashboard");
  const expenses = effectiveCanAccessModule(perms, "expenses");
  const commissions = effectiveCanAccessModule(perms, "commissions");
  const canCreate = effectiveHasPermission(perms, "expenses", "create");
  return (
    <ListPage>
      <ListHero
        eyebrow={expenses ? FINANCE_HERO_TEXT.eyebrow : "Finans merkezi"}
        art={expenses ? "gider" : "komisyon"}
        title="Finans"
        description={expenses ? FINANCE_HERO_TEXT.description : FINANCE_HERO_TEXT.commissionsOnly}
        actions={canCreate ? <FinanceActions commissions={commissions} /> : null}
      />
      {children}
    </ListPage>
  );
}
