"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminRaporlarError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Platform raporları" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
