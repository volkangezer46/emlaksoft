"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminConsentError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="İleti izinleri" homeHref="/admin" homeLabel="Kontrol paneline dön" />;
}
