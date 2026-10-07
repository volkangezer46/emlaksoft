"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

/** /admin genel hata sınırı (kanonik görünüm `ui/route-error`). */
export default function AdminError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Yönetim paneli" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
