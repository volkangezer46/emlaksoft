"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminSatisError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Satış" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
