"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminSistemError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Sistem" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
