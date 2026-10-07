"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminPersonelError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Personel" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
