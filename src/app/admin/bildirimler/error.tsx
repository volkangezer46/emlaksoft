"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminBildirimlerError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Bildirimler" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
