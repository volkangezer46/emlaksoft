"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminSiteMediaError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Medya" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
