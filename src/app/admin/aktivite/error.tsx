"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminAktiviteError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Platform etkinliği" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
