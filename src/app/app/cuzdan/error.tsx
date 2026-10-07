"use client";

import { RouteError, type RouteErrorBoundaryProps } from "@/components/ui/route-error";

export default function CuzdanError(props: RouteErrorBoundaryProps) {
  return <RouteError {...props} moduleName="Kazanç" />;
}
