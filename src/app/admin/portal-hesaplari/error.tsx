"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminPortalAccountsError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Portal hesapları" homeHref="/admin" homeLabel="Kontrol paneline dön" />;
}
