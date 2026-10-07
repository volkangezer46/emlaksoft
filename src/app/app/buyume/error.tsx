"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function BuyumeError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Büyüme" />;
}
