"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminGeoError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Coğrafya" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
