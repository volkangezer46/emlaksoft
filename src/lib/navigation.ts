function withoutTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

/**
 * Returns the single, most-specific navigation target for a pathname.
 * `rootHref` is exact-only so the application home item does not remain active
 * on every nested route.
 */
export function findActiveNavigationHref(
  pathname: string,
  hrefs: readonly string[],
  rootHref: string,
): string | null {
  const currentPath = withoutTrailingSlash(pathname);
  const normalizedRoot = withoutTrailingSlash(rootHref);
  let activeHref: string | null = null;
  let activeLength = -1;

  for (const href of hrefs) {
    const target = withoutTrailingSlash(href);
    const matches = target === normalizedRoot
      ? currentPath === target
      : currentPath === target || currentPath.startsWith(`${target}/`);

    if (matches && target.length > activeLength) {
      activeHref = href;
      activeLength = target.length;
    }
  }

  return activeHref;
}
