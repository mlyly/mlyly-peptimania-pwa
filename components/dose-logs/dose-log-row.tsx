"use client";

import * as React from "react";
import {ClipboardList, MapPin, MoreHorizontal, Pencil, Trash2,} from "lucide-react";

import type {DoseLog, Medication} from "@/lib/db/types";
import {medicationTypeMeta} from "@/lib/medications/constants";
import {formatDateTimeCompact} from "@/lib/scheduling/dates";
import {formatAmount} from "@/lib/units";
import {cn} from "@/lib/utils";

import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,} from "@/components/ui/dropdown-menu";

export interface DoseLogRowProps {
    log: DoseLog;
    /** The medication this log references (null when it was deleted). */
    medication: Medication | null;
    onEdit: (log: DoseLog) => void;
    onDelete: (log: DoseLog) => void;
    /** Disables actions while a write is in flight for this row. */
    busy?: boolean;
}

/**
 * One dose in the history — a compact single line: date + time, what and how
 * much, then site / origin / notes and quick actions.
 */
export function DoseLogRow({
                               log,
                               medication,
                               onEdit,
                               onDelete,
                               busy = false,
                           }: DoseLogRowProps) {
    const meta = medication ? medicationTypeMeta(medication.type) : null;
    const time = React.useMemo(() => new Date(log.timestamp), [log.timestamp]);
    const fromSchedule = log.scheduleId !== undefined;

    return (
        <Card className="gap-0 py-1.5">
            <div className="flex items-center gap-2 px-3">
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {formatDateTimeCompact(time)}
                </span>
                <span
                    className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-md border",
                        meta?.badgeClass ?? "border-border bg-muted text-muted-foreground"
                    )}
                >
                    {meta ? (
                        <meta.icon className="size-3.5" aria-hidden/>
                    ) : (
                        <ClipboardList className="size-3.5" aria-hidden/>
                    )}
                </span>
                <p className="min-w-0 truncate text-sm leading-tight font-semibold">
                    {medication?.name ?? "Unknown medication"}
                    <span className="text-muted-foreground font-normal">
                        {" "}· {formatAmount(log.doseAmount, log.unit)}
                    </span>
                </p>
                {log.injectionSite && (
                    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[11px]">
                        <MapPin className="mr-1 size-3" aria-hidden/>
                        {log.injectionSite}
                    </Badge>
                )}
                {fromSchedule && (
                    <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[11px]">
                        From schedule
                    </Badge>
                )}
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
                                aria-label={`Actions for ${medication?.name ?? "this dose"}`}
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
