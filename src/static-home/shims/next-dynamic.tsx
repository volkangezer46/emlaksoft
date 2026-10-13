import { Suspense, lazy, type ComponentType } from "react";

type Loader<P> = () => Promise<ComponentType<P> | { default: ComponentType<P> }>;

/** Statik ana sayfa adacıklarında `next/dynamic` karşılığı (yalnız istemci; `loading` beklerken gösterilir). */
export default function dynamic<P extends object>(loader: Loader<P>, opts: { loading?: ComponentType; ssr?: boolean } = {}) {
  const Lazy = lazy(async () => {
    const m = await loader();
    return { default: "default" in m ? m.default : m };
  });
  const Loading = opts.loading;
  return function Dynamic(props: P) {
    return (
      <Suspense fallback={Loading ? <Loading /> : null}>
        <Lazy {...props} />
      </Suspense>
    );
  };
}
