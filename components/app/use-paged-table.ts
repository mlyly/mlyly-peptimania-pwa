/**
 * Client-side pagination for the app's paged lists.
 *
 * The page size is stored in the `paging.pageSize` setting keyed by table id,
 * so every paged list remembers the user's choice across sessions. Page
 * position itself is transient: the page resets when `resetKey` changes
 * (filters, search, ...) and is clamped to the available pages.
 */
"use client";

import * as React from "react";

import {useAppSettings} from "@/lib/settings/store";
import {type PagedTableId, type PageSize} from "@/lib/settings/definitions";

/** Page size used by a list when the user has not picked one yet. */
export const DEFAULT_PAGE_SIZE: PageSize = 20;

export interface PagedTable<T> {
    /** Current page size (setting value or the list default). */
    pageSize: PageSize;
    /** Persists the page size for this list and returns to page 1. */
    setPageSize: (size: PageSize) => void;
    /** 1-based current page, clamped to `[1, pageCount]`. */
    page: number;
    setPage: (page: number) => void;
    /** Number of pages; 1 when `pageSize === "all"`. */
    pageCount: number;
    /** Total number of items after filtering. */
    totalItems: number;
    /** The items to render for the current page. */
    items: T[];
    /** 1-based index of the first item on the page (0 when empty). */
    rangeStart: number;
    /** 1-based index of the last item on the page. */
    rangeEnd: number;
    /** True when the list should show any pagination affordance at all. */
    showPager: boolean;
}

export function usePagedTable<T>(
    tableId: PagedTableId,
    items: readonly T[],
    resetKey: string
): PagedTable<T> {
    const {settings, setSetting} = useAppSettings();
    const pageSize = settings["paging.pageSize"][tableId] ?? DEFAULT_PAGE_SIZE;

    const [pageState, setPageState] = React.useState<{
        key: string;
        size: PageSize;
        page: number;
    }>({key: resetKey, size: pageSize, page: 1});

    // Page position resets automatically when the filter/search context or
    // the page size changes (state stored alongside its inputs — no effect).
    const fresh = pageState.key === resetKey && pageState.size === pageSize;
    const rawPage = fresh ? pageState.page : 1;
    const goPage = React.useCallback(
        (page: number) => {
            setPageState({key: resetKey, size: pageSize, page});
        },
        [resetKey, pageSize]
    );

    const persistPageSize = React.useCallback(
        (size: PageSize) => {
            void setSetting("paging.pageSize", {
                ...settings["paging.pageSize"],
                [tableId]: size,
            });
        },
        [setSetting, settings, tableId]
    );

    const pageCount =
        pageSize === "all" ? 1 : Math.max(1, Math.ceil(items.length / pageSize));
    const page = Math.min(rawPage, pageCount);
    const start = pageSize === "all" ? 0 : (page - 1) * pageSize;
    const end =
        pageSize === "all"
            ? items.length
            : Math.min(start + pageSize, items.length);

    return {
        pageSize,
        setPageSize: persistPageSize,
        page,
        setPage: goPage,
        pageCount,
        totalItems: items.length,
        items: items.slice(start, end),
        rangeStart: items.length === 0 ? 0 : start + 1,
        rangeEnd: end,
        showPager: items.length > 0,
    };
}
