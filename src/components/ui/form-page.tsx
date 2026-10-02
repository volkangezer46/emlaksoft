import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import type { BreadcrumbItem } from "@/components/ui/breadcrumb";
import { cn } from "@/lib/utils";

/**
 * FormPage — "Yeni X ekle" akışları için TEK tam sayfa form iskeleti.
 *
 * Eskiden her oluşturma akışı bir popup (Dialog) idi: dar alan, kaybolan taslak,
 * mobilde sıkışık, geri tuşuyla kapanmayan. Artık her modülün `…/yeni` sayfası
 * vardır: PageHeader + bölümlü kartlar + sticky alt eylem çubuğu. Form gövdesi
 * (server action + useActionState) aynı kalır; başarıda `redirect` ile
 * detay/liste sayfasına gidilir.
 *
 * Kullanım:
 *   <FormPage title="Yeni müşteri" breadcrumbs={[...]}>
 *     <FormSection title="Kişi bilgileri" description="…">…alanlar…</FormSection>
 *     <FormActions>…iptal + kaydet…</FormActions>
 *   </FormPage>
 * `FormPage` bir `<form>` DEĞİLDİR; `<form action={…}>` çağıran bileşen, FormPage'i
 * form içine koyar (FormActions form içinde kalmalı ki submit çalışsın).
 */
export function FormPage({
  title,
  description,
  eyebrow,
  breadcrumbs,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  breadcrumbs?: BreadcrumbItem[];
  /** Başlık yanındaki ikincil bağlantılar (ör. "İçe aktar"). */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-3xl", className)}>
      <PageHeader title={title} description={description} eyebrow={eyebrow} breadcrumbs={breadcrumbs} actions={actions} />
      <div className="space-y-5">{children}</div>
    </div>
  );
}

/** Formun mantıksal bölümü: başlık + açıklama + alan ızgarası. */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-[var(--shadow-sm)]", className)}>
      <div className="mb-4">
        <h2 className="font-display text-base font-semibold text-text">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-text-muted">{description}</p> : null}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

/** Sayfa altında yapışkan eylem çubuğu: iptal (sol/ikincil) + kaydet (birincil). */
export function FormActions({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface/95 px-1 py-3 backdrop-blur supports-[padding:max(0px)]:pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        className,
      )}
    >
      {children}
    </div>
  );
}
