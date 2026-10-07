"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function FranchiseError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Şube yönetimi" />;
}
