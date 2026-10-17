"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminOfficeHealthError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Sağlık ve risk" homeHref="/admin" homeLabel="Kontrol paneline dön" />;
}
