import { EmptyState as PremiumEmptyState } from "./empty-state";

/**
 * Global loading component
 * Suspense fallback ve sayfa yüklenirken gösterilir
 */
export function LoadingScreen() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div role="status" className="text-center">
        <div aria-hidden="true" className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-brand-600/20 border-t-brand-600" />
        <p className="mt-4 text-sm text-text-muted">Yükleniyor...</p>
      </div>
    </div>
  );
}

/**
 * Empty state component — premium EmptyState'e delege eder.
 * İki farklı boş durum görünümü yaşıyordu; standart tek: empty-state.tsx.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <PremiumEmptyState
      icon={icon}
      title={title}
      description={description}
      action={action ? { node: action } : undefined}
    />
  );
}

/**
 * Page header with actions
 */
export function PageHeader({
  title,
  description,
  badge,
  actions,
}: {
  title: string;
  description?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        {badge}
        <h1 className="font-display text-2xl font-extrabold text-ink-950 md:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}