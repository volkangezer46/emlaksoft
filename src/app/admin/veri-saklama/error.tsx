"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminRetentionError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Veri saklama" homeHref="/admin" homeLabel="Kontrol paneline dön" />;
}
