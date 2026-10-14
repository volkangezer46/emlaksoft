"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminSiteMenuError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Site menüsü" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
