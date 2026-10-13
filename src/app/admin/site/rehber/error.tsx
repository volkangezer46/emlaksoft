"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminGuidesError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Rehber" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
