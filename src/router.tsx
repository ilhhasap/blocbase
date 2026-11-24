import { createRouter } from "@tanstack/react-router";
import { NotFound } from "@/components/not-found";
import { AppErrorComponent } from "@/lib/error-component";
import { routeTree } from "./routeTree.gen";

/** The page a path belongs to: `/`, `/sections`, `/pricing`... A block editor (`/b/...`) is an overlay, not a page. */
const pageOf = (pathname: string) => (pathname.startsWith("/b/") ? null : pathname.replace(/\/+$/, "") || "/");

export function getRouter() {
  return createRouter({
    routeTree,
    // Moving between pages cross-fades the page under the fixed navbar (see "Page transitions" in styles.css);
    // opening or closing a block editor, or a change within one page, does not animate.
    defaultViewTransition: {
      types: ({ fromLocation, toLocation }) => {
        const from = fromLocation ? pageOf(fromLocation.pathname) : null;
        const to = pageOf(toLocation.pathname);
        return from && to && from !== to ? ["page"] : false;
      },
    },
    defaultErrorComponent: AppErrorComponent,
    defaultNotFoundComponent: NotFound,
  });
}
