"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminTicketsError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Destek talepleri" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
