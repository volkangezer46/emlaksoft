/**
 * Global loading component
 * Suspense fallback ve sayfa yüklenirken gösterilir
 */
export function LoadingScreen() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="text-center">
        <div className="inline-block h-12 w-12 animate-spin rounded-full border-4 border-brand-600/20 border-t-brand-600" />
        <p className="mt-4 text-sm text-text-muted">Yükleniyor...</p>
      </div>
    </div>
  );
}

/**
 * Empty state component
 */
export function EmptyState({
  icon: Icon,
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
    <div className="flex min-h-[40vh] items-center justify-center px-4">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-[16px] bg-canvas">
          <Icon className="h-8 w-8 text-text-muted" />
        </div>
        <h3 className="mt-4 font-display text-lg font-bold text-ink-950">{title}</h3>
        {description && <p className="mt-2 text-sm text-text-muted">{description}</p>}
        {action && <div className="mt-6">{action}</div>}
      </div>
    </div>
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