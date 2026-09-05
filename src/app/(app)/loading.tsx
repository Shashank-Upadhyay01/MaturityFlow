import { Glass } from '@/components/ui/glass';
import { Skeleton } from '@/components/ui/misc';

/*
  What the branch sees while a page is on its way.

  Every route in this group is force-dynamic, so a click used to leave the previous page on
  screen, untouched, until the server had run every query and sent the whole thing back. On the
  branch's connection that is one to three seconds of a screen that looks like nothing happened,
  and the honest reading of it is that the click was missed - so it gets clicked again.

  A loading file is the cheapest fix there is: Next paints it the instant the link is followed,
  the topbar and the chrome stay put because they belong to the layout above this, and only the
  page body is replaced. It also gives the router a boundary to prefetch up to, so the shell of
  a page can arrive before its data does.

  Deliberately generic - a page-shaped grey, not an imitation of any one screen. A skeleton that
  pretends to be the register and then resolves into something laid out differently is worse than
  one that never pretended.
*/
export default function AppLoading() {
  return (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>

      <Glass className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
        <div className="space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-64" />
        </div>
        <Skeleton className="h-7 w-28" />
      </Glass>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Glass key={i} className="space-y-2.5 p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-28" />
          </Glass>
        ))}
      </div>

      <Glass className="overflow-hidden">
        <div className="flex items-center gap-3 border-b px-3 py-2.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="ml-auto h-3 w-16" />
        </div>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 border-b border-[var(--hairline)] px-3 py-2.5 last:border-0"
            // Rows fade in a touch apart so the block reads as a list rather than a grey slab.
            style={{ opacity: 1 - i * 0.09 }}
          >
            <Skeleton className="h-3 w-6" />
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="ml-auto h-3 w-20" />
          </div>
        ))}
      </Glass>
    </div>
  );
}
