"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function DestekError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Destek talepleri" />;
}
