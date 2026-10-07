"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function AramaError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Arama merkezi" />;
}
