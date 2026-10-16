import { notFound } from "next/navigation";
import Link from "@/components/ui/smart-link";
import { ArrowLeft, LifeBuoy } from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { FAQ_CATEGORIES } from "@/lib/help-faq";
import { codeDraft, codeSlugs, HELP_SLUG_RE, isHelpKind, voteKey } from "@/lib/help-center/core";
import { findHelpArticle, readVoteTallies } from "@/lib/help-center/store";
import { requirePlatformModule } from "@/lib/platform";
import { HelpArticleEditor } from "./help-article-editor";

export const metadata = { title: "Yardım makalesi" };

/**
 * Yardım makalesi düzenleme: `?tur=&slug=` mevcut (kod ya da DB) maddeyi, parametresiz çağrı yeni makaleyi açar.
 * Yayındaki makalede düzenleme taslağa yazılır; "Yayınla" ile canlıya geçer.
 */
export default async function HelpArticleEditPage({ searchParams }: { searchParams: Promise<{ tur?: string; slug?: string }> }) {
  const [staff, sp] = await Promise.all([requirePlatformModule("sitecontent"), searchParams]);
  const canWrite = staff.role === "super_admin";
  const isNew = !sp.slug;
  if (!isNew && (!isHelpKind(sp.tur) || !HELP_SLUG_RE.test(sp.slug ?? ""))) notFound();
  const kind = isHelpKind(sp.tur) ? sp.tur : "faq";
  const slug = sp.slug ?? "";
  const [row, votes] = await Promise.all([
    isNew ? Promise.resolve(null) : findHelpArticle(kind, slug).catch(() => null),
    isNew ? Promise.resolve(null) : readVoteTallies().catch(() => null),
  ]);
  const fromCode = !isNew && codeSlugs(kind).includes(slug);
  const seed = row ? (row.draft ?? row) : fromCode ? codeDraft(kind, slug) : null;
  if (!isNew && !seed) notFound();
  const tally = votes?.get(voteKey(kind, slug)) ?? null;

  return (
    <div className="space-y-6">
      <Link href="/admin/tickets/yardim" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-text-muted hover:text-brand-600">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Yardım merkezi
      </Link>
      <AdminPageHeader
        art="document"
        eyebrow="Talepler > Yardım merkezi"
        icon={LifeBuoy}
        title={isNew ? "Yeni yardım makalesi" : (seed?.title ?? slug)}
        description={
          isNew
            ? "Taslak olarak kaydedilir; yayınlayınca ofislerin Yardım ekranında hemen aranabilir."
            : row
              ? row.status === "published"
                ? row.draft
                  ? "Yayında; bekleyen düzenleme var (yayınlayınca görünür)."
                  : "Yayında."
                : row.status === "hidden"
                  ? "Gizli; Yardım merkezinde görünmüyor."
                  : "Taslak; henüz yayında değil."
              : "Koddaki madde; düzenleyip yayınlarsanız koddaki metnin yerine geçer."
        }
      />
      {tally ? (
        <p className="text-sm text-text-muted">
          Okuyucu oyu: {tally.helpful} &quot;işe yaradı&quot;, {tally.notHelpful} &quot;yaramadı&quot;.
        </p>
      ) : null}
      <HelpArticleEditor
        isNew={isNew}
        canWrite={canWrite}
        fromCode={fromCode}
        status={row?.status ?? null}
        hasPendingEdit={Boolean(row?.draft)}
        initial={{
          kind,
          slug,
          sort: row?.sort ?? 100,
          title: seed?.title ?? "",
          summary: seed?.summary ?? "",
          body: seed?.body ?? "",
          category: seed?.category ?? "",
          href: seed?.href ?? "",
          hrefLabel: seed?.hrefLabel ?? "",
        }}
        categories={FAQ_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
      />
    </div>
  );
}
