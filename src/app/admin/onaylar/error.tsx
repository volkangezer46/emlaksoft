"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminOnaylarError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Onaylar" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
