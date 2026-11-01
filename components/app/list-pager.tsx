/**
 * Compact pagination controls shared by all paged lists: a page-size picker
 * (selection persisted per table via `paging.pageSize`) plus prev/next and a
 * "Showing x–y of n" readout.
 */
"use client";

import * as React from "react";
import {ChevronLeft, ChevronRight} from "lucide-react";

import {PAGE_SIZES, type PageSize, pageSizeLabel} from "@/lib/settings/definitions";
import {Button} from "@/components/ui/button";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@/components/ui/select";

export interface ListPagerProps {
    pageSize: PageSize;
    onPageSizeChange: (size: PageSize) => void;
    /** 1-based current page. */
    page: number;
    pageCount: number;
    onPageChange: (page: number) => void;
    rangeStart: number;
    rangeEnd: number;
    totalItems: number;
    /** Noun for the item count, e.g. "doses". */
    itemNoun: string;
}

export function ListPager({
                              pageSize,
                              onPageSizeChange,
                              page,
                              pageCount,
                              onPageChange,
                              rangeStart,
                              rangeEnd,
                              totalItems,
                              itemNoun,
                          }: ListPagerProps) {
    const paged = pageCount > 1;
    return (
        <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
                <span>
                    <Select
                        value={String(pageSize)}
                        onValueChange={(value) =>
                            onPageSizeChange(value === "all" ? "all" : Number(value) as PageSize)
                        }
                    >
                        <SelectTrigger size="sm" className="w-24" aria-label="Rows per page">
                            <SelectValue/>
                        </SelectTrigger>
                        <SelectContent>
                            {PAGE_SIZES.map((size) => (
                                <SelectItem key={String(size)} value={String(size)}>
                                    {pageSizeLabel(size)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </span>
                <span className="text-muted-foreground text-sm tabular-nums">
                    Showing {rangeStart}–{rangeEnd} of {totalItems} {itemNoun}
                </span>
            </div>
            {paged && (
                <div className="flex items-center gap-1.5">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onPageChange(page - 1)}
                        disabled={page <= 1}
                        aria-label="Previous page"
                    >
                        <ChevronLeft className="size-4" aria-hidden/>
                    </Button>
                    <span className="text-muted-foreground text-sm tabular-nums">
                        Page {page} of {pageCount}
                    </span>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onPageChange(page + 1)}
                        disabled={page >= pageCount}
                        aria-label="Next page"
                    >
                        <ChevronRight className="size-4" aria-hidden/>
                    </Button>
                </div>
            )}
        </div>
    );
}
