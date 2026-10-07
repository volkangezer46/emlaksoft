"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function IlanHavuzuError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="İlan havuzu" />;
}
