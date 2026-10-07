"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminHatalarError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Hata kayıtları" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
