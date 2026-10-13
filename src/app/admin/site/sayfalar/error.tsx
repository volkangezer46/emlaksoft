"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminSitePagesError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Sayfalar" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
