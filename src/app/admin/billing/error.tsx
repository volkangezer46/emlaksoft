"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminBillingError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Faturalama" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
