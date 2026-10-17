"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminOfficeSessionsError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Ofis oturumları" homeHref="/admin" homeLabel="Kontrol paneline dön" />;
}
