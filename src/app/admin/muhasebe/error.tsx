"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminMuhasebeError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Muhasebe" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
