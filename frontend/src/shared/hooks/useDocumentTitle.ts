import { useEffect } from 'react';

const BASE_TITLE = 'BizPilot AI';

/**
 * Phase 34 Track M: every route showed the same static "BizPilot AI" browser
 * tab title before this — real, minor but genuine SEO/UX gap for a
 * production product (bookmarks, browser history, and multi-tab navigation
 * all read the tab title). Restores BASE_TITLE on unmount so navigating away
 * (including client-side back/forward) never leaves a stale title behind.
 */
export function useDocumentTitle(pageTitle: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = `${pageTitle} · ${BASE_TITLE}`;
    return () => {
      document.title = previous;
    };
  }, [pageTitle]);
}
