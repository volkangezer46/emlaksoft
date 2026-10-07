"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminSiteError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Site ayarları" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
