"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminAyarlarError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Platform ayarları" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
