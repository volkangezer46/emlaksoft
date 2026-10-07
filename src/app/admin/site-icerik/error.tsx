"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminSiteIcerikError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Site içeriği" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
