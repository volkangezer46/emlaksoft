import { earningsPath, financePath } from "@/lib/finance/routes";
import { Wallet } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { canHandleSalary } from "@/lib/finance/cash/categories";
import { entryReturnHref, parseEntryPrefill } from "@/lib/finance/entry-workspace";
import { requireModulePage } from "@/lib/require-module-page";
import { loadEntryContext } from "./_data";
import { suggestEntryRule } from "./actions";
import { EntryWorkspace } from "./_components/entry-workspace";

/**
 * Finans > Yeni kayıt (TAM SAYFA, popup yok): Gider · Gelir · Transfer · Fatura/Belge · Toplu giriş sekmeleri.
 * Kapı: ofis kipi `expenses` modül sayfası (+ paket kilidi); `?kapsam=kisisel` (Kasam) yalnız oturum (`dashboard`) ister ve
 * yalnız kullanıcının kendi kişisel hesaplarını gösterir. Ofis kaydı yazma `expenses:create` (eylemler ayrıca doğrular).
 * Önceden doldurma parametreleri: `parseEntryPrefill` (eski "finance:new-entry" olayının yerini alan bağlantılar).
 */

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function generateMetadata({ searchParams }: { searchParams?: SearchParams }) {
  const p = parseEntryPrefill((await searchParams) ?? {});
  return { title: p.personal ? "Gelir/Gider ekle · Kasam" : "Gelir/Gider ekle · Finans" };
}

export default async function EntryPage({ searchParams }: { searchParams?: SearchParams }) {
  const prefill = parseEntryPrefill((await searchParams) ?? {});
  const personal = prefill.personal;
  const { perms, userId, role } = personal ? await requireModulePage("dashboard") : await requireModulePage("expenses", financePath());
  const canCreate = !personal && (perms.expenses?.includes("create") ?? false);
  const ctx = await loadEntryContext({ personal, userId, canOffice: canCreate });
  const returnHref = entryReturnHref(personal);

  const breadcrumbs = personal
    ? [{ label: "Hesabım", href: "/app/hesabim" }, { label: "Kasam", href: returnHref }, { label: "Gelir/Gider ekle" }]
    : [{ label: "Finans", href: financePath() }, { label: "Hareketler", href: returnHref }, { label: "Gelir/Gider ekle" }];

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4">
      <PageHeader
        eyebrow={personal ? "Kasam" : "Finans"}
        title="Gelir/Gider ekle"
        breadcrumbs={breadcrumbs}
        description={
          personal
            ? "Kişisel gelir ve giderleriniz: yalnız siz görürsünüz, ofis kâr-zararına girmez."
            : "Tutarı yazın, kategoriyi seçin ve kaydedin. Fişin fotoğrafını da çekebilirsiniz."
        }
      />
      {!canCreate && ctx.accounts.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={personal ? "Önce kişisel bir hesap açın" : "Kayıt ekleme yetkiniz yok"}
          description={
            personal
              ? "Kasam'da bir kasa ya da banka hesabı açın; kişisel hareketler o hesaba yazılır."
              : "Ofis kaydı eklemek için muhasebe ekleme yetkisi gerekir. Kişisel gelir ve giderlerinizi Kasam'dan takip edebilirsiniz."
          }
          action={{ href: personal ? returnHref : earningsPath("kasam"), label: personal ? "Kasam'a git" : "Kasam'ı aç" }}
          tone="amber"
        />
      ) : (
        <EntryWorkspace
          prefill={prefill}
          canInvoice={!personal && (perms.commissions?.includes("create") ?? false)}
          ocrEnabled={ctx.ocrEnabled}
          ctx={{
            userId,
            personal,
            office: canCreate,
            today: ctx.today,
            accounts: ctx.accounts,
            categories: ctx.categories,
            recent: ctx.recent,
            budgets: ctx.budgets,
            vatIncludedDefault: ctx.vatIncludedDefault,
            canSalary: !personal && canHandleSalary(role),
            suggestRule: canCreate ? suggestEntryRule : undefined,
            returnHref,
          }}
        />
      )}
    </div>
  );
}
