import { useCallback, useRef } from "react";

/**
 * Encapsulates the IntersectionObserver + callback-ref pattern for infinite
 * scroll. Returns a callback ref to attach to a sentinel DOM element.
 *
 * The sentinel is observed with a 400px rootMargin so the next page is
 * fetched before the user scrolls all the way to the bottom.
 */
export function useInfiniteScroll(opts: {
  hasNextPage: boolean | undefined;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
}): (el: HTMLDivElement | null) => void {
  const hasNextRef = useRef(opts.hasNextPage);
  const fetchingRef = useRef(opts.isFetchingNextPage);
  const fetchNextRef = useRef(opts.fetchNextPage);
  hasNextRef.current = opts.hasNextPage;
  fetchingRef.current = opts.isFetchingNextPage;
  fetchNextRef.current = opts.fetchNextPage;

  const observerRef = useRef<IntersectionObserver | null>(null);

  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextRef.current && !fetchingRef.current) {
          fetchNextRef.current();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  return sentinelRef;
}
