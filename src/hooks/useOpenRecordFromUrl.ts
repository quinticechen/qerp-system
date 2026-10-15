import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Query parameter naming the record a page should open (docs/requirements/QUERY_UI_LAYOUT_AND_RECORD_NAV.md §1.3). */
export const OPEN_RECORD_PARAM = 'open';
/** Optional tab the page shows first (e.g. 入庫記錄 on /inventory). */
export const OPEN_TAB_PARAM = 'tab';

/**
 * Opens the record named by `?open=<id>` once, then removes the parameters, so a reload or the
 * back button does not open it again. The page passes the setter of its dialog state; a record
 * not loaded yet opens when its data arrives, because pages find the record by id.
 */
export function useOpenRecordFromUrl(onOpen: (id: string) => void): void {
  const [params, setParams] = useSearchParams();
  const id = params.get(OPEN_RECORD_PARAM);
  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;

  useEffect(() => {
    if (!id) return;
    onOpenRef.current(id);
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete(OPEN_RECORD_PARAM);
        next.delete(OPEN_TAB_PARAM);
        return next;
      },
      { replace: true },
    );
  }, [id, setParams]);
}
