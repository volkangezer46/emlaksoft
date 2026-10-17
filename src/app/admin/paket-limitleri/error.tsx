"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminPlanLimitsError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Paket limitleri" homeHref="/admin" homeLabel="Kontrol paneline dön" />;
}
