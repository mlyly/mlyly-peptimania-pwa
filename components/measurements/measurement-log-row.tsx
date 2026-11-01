"use client";

import * as React from "react";
import {MoreHorizontal, Pencil, Trash2} from "lucide-react";

import type {MeasurementLog, MeasurementType} from "@/lib/db/types";
import {effectiveKind, formatStoredValue} from "@/lib/measurements/derived";
import {formatDateTimeCompact} from "@/lib/scheduling/dates";

import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,} from "@/components/ui/dropdown-menu";

export interface MeasurementLogRowProps {
    log: MeasurementLog;
    /** The tracker this reading belongs to (null when it was deleted). */
    type: MeasurementType | null;
    onEdit: (log: MeasurementLog) => void;
    onDelete: (log: MeasurementLog) => void;
    /** Disables actions while a write is in flight for this row. */
    busy?: boolean;
}

/**
 * One reading in the history — a compact single line: date + time, value,
 * notes and quick actions.
 */
export function MeasurementLogRow({
                                      log,
                                      type,
                                      onEdit,
                                      onDelete,
                                      busy = false,
                                  }: MeasurementLogRowProps) {
    const time = React.useMemo(() => new Date(log.timestamp), [log.timestamp]);
    const valueText = formatStoredValue(log.value, effectiveKind(type), type?.unit ?? "");

    return (
        <Card className="gap-0 py-1.5">
            <div className="flex items-center gap-2 px-3">
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {formatDateTimeCompact(time)}
                </span>
                <span className="text-sm leading-tight font-semibold tabular-nums">
                    {valueText || type?.name || "Reading"}
                </span>
                {log.notes && (
                    <span className="text-muted-foreground min-w-0 truncate text-xs">
                        {log.notes}
                    </span>
                )}

                <div className="ml-auto flex shrink-0 items-center">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-7"
                                aria-label={`Actions for ${valueText || "this reading"}`}
                                disabled={busy}
                            >
                                <MoreHorizontal className="size-4" aria-hidden/>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => onEdit(log)}>
                                <Pencil className="size-4" aria-hidden/>
                                Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => onDelete(log)}
                            >
                                <Trash2 className="size-4" aria-hidden/>
                                Delete…
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </Card>
    );
}
