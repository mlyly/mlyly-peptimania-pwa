"use client";

import * as React from "react";
import {ExternalLink, Pencil} from "lucide-react";

import type {InventoryLot} from "@/lib/db/types";
import {lotTotalAmount, lotTotalPrice} from "@/lib/medications/derived";
import {formatAmount, formatNumber, formatPrice} from "@/lib/units";
import {cn} from "@/lib/utils";

export interface InventoryLotListProps {
    lots: InventoryLot[];
    /** Noun for one container, e.g. "vial" or "bottle". */
    containerNoun: string;
    /** Opens the edit view for the selected lot. */
    onEdit: (lot: InventoryLot, index: number) => void;
    className?: string;
}

/**
 * Compact, clickable inventory-lot rows shared by the medications list and
 * the edit-medication dialog. Each row opens the single-lot editor.
 */
export function InventoryLotList({
                                     lots,
                                     containerNoun,
                                     onEdit,
                                     className,
                                 }: InventoryLotListProps) {
    return (
        <ul className={cn("flex flex-col gap-1.5", className)}>
            {lots.map((lot, index) => {
                // Defensive: imported payloads bypass the form schema, so never
                // turn a stored string into a non-http link target.
                const coaUrls = (lot.coaUrls ?? []).filter((url) =>
                    /^https?:\/\//i.test(url)
                );
                const lotPrice = lotTotalPrice(lot);
                return (
                    <li key={lot.id}>
                        <div
                            role="button"
                            tabIndex={0}
                            aria-label={`Edit inventory lot ${index + 1}`}
                            onClick={() => onEdit(lot, index)}
                            onKeyDown={(event) => {
                                if (event.target !== event.currentTarget) return;
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    onEdit(lot, index);
                                }
                            }}
                            className={cn(
                                "border-border/60 hover:bg-muted/40 focus-visible:ring-ring/50 flex cursor-pointer flex-col gap-1 rounded-md border px-2.5 py-1.5 text-xs transition-colors focus-visible:ring-[3px] focus-visible:outline-none",
                                lot.vialCount === 0 && "opacity-60"
                            )}
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="font-medium tabular-nums">
                                        {formatNumber(lot.vialCount)} ×{" "}
                                        {formatAmount(lot.contentAmount, lot.contentUnit)}
                                    </span>
                                    <span className="text-muted-foreground tabular-nums">
                                        = {formatAmount(lotTotalAmount(lot), lot.contentUnit)}
                                    </span>
                                    {lot.vendor && (
                                        <span className="text-muted-foreground truncate">
                                            · {lot.vendor}
                                        </span>
                                    )}
                                    {lot.orderDate && (
                                        <span className="text-muted-foreground tabular-nums">
                                            · ordered {lot.orderDate}
                                        </span>
                                    )}
                                    {lot.deliveryDate && (
                                        <span className="text-muted-foreground tabular-nums">
                                            · delivered {lot.deliveryDate}
                                        </span>
                                    )}
                                    {lotPrice !== null && (
                                        <span className="text-muted-foreground tabular-nums">
                                            · {formatPrice(lotPrice)}
                                            {lot.vialCount > 0 &&
                                                ` (${formatPrice(lotPrice / lot.vialCount)}/${containerNoun})`}
                                        </span>
                                    )}
                                </div>
                                <Pencil
                                    className="text-muted-foreground mt-0.5 size-3 shrink-0"
                                    aria-hidden
                                />
                            </div>
                            {(coaUrls.length > 0 || lot.notes) && (
                                <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1">
                                    {coaUrls.map((url, coaIndex) => (
                                        <a
                                            key={`${lot.id}-coa-${coaIndex}`}
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title={url}
                                            onClick={(event) => event.stopPropagation()}
                                            onKeyDown={(event) => event.stopPropagation()}
                                            className="text-primary inline-flex items-center gap-1 hover:underline"
                                        >
                                            COA
                                            {coaUrls.length > 1 ? ` ${coaIndex + 1}` : ""}
                                            <ExternalLink className="size-3" aria-hidden/>
                                        </a>
                                    ))}
                                    {lot.notes && (
                                        <span className="line-clamp-1">{lot.notes}</span>
                                    )}
                                </div>
                            )}
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
