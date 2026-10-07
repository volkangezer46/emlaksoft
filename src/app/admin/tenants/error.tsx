"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminTenantsError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Ofisler" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
