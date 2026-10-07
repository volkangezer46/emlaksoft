"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AdminMembersError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Üyeler" homeHref="/admin" homeLabel="Yönetim paneline dön" />;
}
