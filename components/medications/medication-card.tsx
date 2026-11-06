"use client";

import * as React from "react";
import {
    CalendarClock,
    FlaskConical,
    Minus,
    MoreHorizontal,
    Pencil,
    Plus,
    Timer,
    Trash2,
    TriangleAlert,
} from "lucide-react";

import type {InventoryLot, Medication, Schedule} from "@/lib/db/types";
import {
    activeSchedulesFor,
    concentrationLabel,
    daysOfStockRemaining,
    formatStockDuration,
    inventoryPriceTotals,
    inventoryStatus,
    inventoryTotals,
    stockRatio,
} from "@/lib/medications/derived";
import {medicationTypeMeta} from "@/lib/medications/constants";
import {formatAmount, formatNumber, formatPrice} from "@/lib/units";
import {cn} from "@/lib/utils";

import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent} from "@/components/ui/card";
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,} from "@/components/ui/dropdown-menu";
import {Progress} from "@/components/ui/progress";
import {InventoryLotList} from "./inventory-lot-list";
import {ScheduleSection} from "./reconstitution-panel";

export interface MedicationCardProps {
    medication: Medication;
    /** All schedules (the card links the active ones for this medication). */
    schedules: Schedule[];
    onEdit: (medication: Medication) => void;
    onDelete: (medication: Medication) => void;
    /** Opens the single-lot editor for one inventory line. */
    onEditLot: (medication: Medication, lot: InventoryLot) => void;
    /** Adds/removes whole containers (FIFO removal, newest-lot top-up). */
    onAdjust: (medication: Medication, vialDelta: number) => void;
    /** Disables quick adjustments while a write is in flight for this row. */
    adjusting?: boolean;
}

const STATUS_BAR: Record<"out" | "low" | "ok", string> = {
    out: "[&_[data-slot=progress-indicator]]:bg-destructive",
    low: "[&_[data-slot=progress-indicator]]:bg-amber-500 dark:[&_[data-slot=progress-indicator]]:bg-amber-400",
    ok: "",
};

const LOW_STOCK_BADGE =
    "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300";

const WARNING_TEXT = "text-amber-600 dark:text-amber-400";

/** Compact medication row: identity, lot-based inventory and schedule linkage. */
export function MedicationCard({
                                   medication,
                                   schedules,
                                   onEdit,
                                   onDelete,
                                   onEditLot,
                                   onAdjust,
                                   adjusting = false,
                               }: MedicationCardProps) {
    const meta = medicationTypeMeta(medication.type);
    const active = React.useMemo(
        () => activeSchedulesFor(schedules, medication.id),
        [schedules, medication.id]
    );
    const status = inventoryStatus(medication);
    const ratio = stockRatio(medication);
    const concentration = concentrationLabel(medication);
    const totals = inventoryTotals(medication);
    const priceTotals = inventoryPriceTotals(medication);
    const daysLeft = daysOfStockRemaining(medication, schedules);
    const duration = formatStockDuration(daysLeft);

    const containerPlural = `${meta.containerNoun}s`;
    const {lots, lowStockThreshold} = medication.inventory;
    const canAdd = !adjusting && lots.length > 0;
    const canRemove = !adjusting && totals.vialCount > 0;

    return (
        <Card className="gap-3 py-4">
            <CardContent className="flex flex-col gap-3 px-4">
                {/* Identity + actions */}
                <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                        <span
                            className={cn(
                                "flex size-8 shrink-0 items-center justify-center rounded-md border",
                                meta.badgeClass
                            )}
                        >
                            <meta.icon className="size-4" aria-hidden/>
                        </span>
                        <div className="min-w-0">
                            <p className="truncate text-sm leading-tight font-semibold">
                                {medication.name}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <Badge
                                    variant="outline"
                                    className={cn("px-1.5 py-0 text-[11px]", meta.badgeClass)}
                                >
                                    {meta.label}
                                </Badge>
                                {status === "out" && (
                                    <Badge variant="destructive" className="px-1.5 py-0 text-[11px]">
                                        Out of stock
                                    </Badge>
                                )}
                                {status === "low" && (
                                    <Badge
                                        variant="outline"
                                        className={cn("px-1.5 py-0 text-[11px]", LOW_STOCK_BADGE)}
                                    >
                                        Low stock
                                    </Badge>
                                )}
                                {concentration && (
                                    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                                        <FlaskConical className="size-3 shrink-0" aria-hidden/>
                                        {concentration.primary}
                                        {concentration.secondary &&
                                            ` (${concentration.secondary})`}
                                    </span>
                                )}
                                {medication.halfLifeHours !== undefined && (
                                    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                                        <Timer className="size-3 shrink-0" aria-hidden/>
                                        t½ {formatNumber(medication.halfLifeHours)} h
                                    </span>
                                )}
                                {medication.absorptionHalfLifeHours !== undefined && (
                                    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                                        <Timer className="size-3 shrink-0" aria-hidden/>
                                        k_a t½ {formatNumber(medication.absorptionHalfLifeHours)} h
                                    </span>
                                )}
                                {medication.absorptionRatePerHour !== undefined && medication.absorptionHalfLifeHours === undefined && (
                                    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                                        <Timer className="size-3 shrink-0" aria-hidden/>
                                        k_a {formatNumber(medication.absorptionRatePerHour)} h⁻¹
                                    </span>
                                )}
                                {active.length > 0 && (
                                    <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                                        <CalendarClock className="size-3 shrink-0" aria-hidden/>
                                        {active.length} active
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label={`Actions for ${medication.name}`}
                            >
                                <MoreHorizontal className="size-4" aria-hidden/>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => onEdit(medication)}>
                                <Pencil className="size-4" aria-hidden/>
                                Edit
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => onDelete(medication)}
                            >
                                <Trash2 className="size-4" aria-hidden/>
                                Delete…
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {/* Inventory tracker */}
                <div className="flex items-center gap-3">
                    <Progress
                        value={ratio * 100}
                        aria-label={`Stock level for ${medication.name}`}
                        className={cn("h-1.5 flex-1", STATUS_BAR[status])}
                    />
                    <span className="tabular-nums text-xs font-medium whitespace-nowrap">
                        {formatAmount(totals.quantity, medication.unit)}
                    </span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="icon"
                            className="size-7"
                            onClick={() => onAdjust(medication, -1)}
                            disabled={!canRemove}
                            aria-label={`Remove one ${meta.containerNoun}`}
                        >
                            <Minus className="size-3.5" aria-hidden/>
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            className="size-7"
                            onClick={() => onAdjust(medication, 1)}
                            disabled={!canAdd}
                            aria-label={`Add one ${meta.containerNoun}`}
                        >
                            <Plus className="size-3.5" aria-hidden/>
                        </Button>
                    </div>
                </div>

                <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span className="tabular-nums">
                        {formatNumber(totals.vialCount)}{" "}
                        {totals.vialCount === 1 ? meta.containerNoun : containerPlural}
                    </span>
                    <span className="tabular-nums">
                        · {totals.lotCount} {totals.lotCount === 1 ? "lot" : "lots"}
                    </span>
                    {lowStockThreshold !== undefined && (
                        <span className="tabular-nums">
                            · alert ≤ {formatAmount(lowStockThreshold, medication.unit)}
                        </span>
                    )}
                    {duration !== null && status !== "out" && (
                        <span
                            className={cn(
                                "tabular-nums",
                                status === "low" && WARNING_TEXT
                            )}
                        >
                            · ≈ {duration} of doses
                        </span>
                    )}
                    {duration === null && active.length > 0 && totals.quantity > 0 && (
                        <span className={cn("tabular-nums", WARNING_TEXT)}>
                            · duration unavailable
                        </span>
                    )}
                    {priceTotals.pricedLots > 0 && (
                        <span className="tabular-nums">
                            · stock value {formatPrice(priceTotals.totalPrice)}
                            {priceTotals.unpricedLots > 0 &&
                                ` (${priceTotals.unpricedLots} unpriced)`}
                        </span>
                    )}
                </div>

                {totals.unconvertibleLots > 0 && (
                    <p className={cn("inline-flex items-start gap-1.5 text-xs", WARNING_TEXT)}>
                        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden/>
                        {totals.unconvertibleLots}{" "}
                        {totals.unconvertibleLots === 1 ? "lot uses" : "lots use"} a content
                        unit that can’t be expressed in {medication.unit}. They are excluded
                        from stock and duration.
                    </p>
                )}

                {/* Lots */}
                {lots.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                        <p className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                            Inventory lots
                        </p>
                        <InventoryLotList
                            lots={lots}
                            containerNoun={meta.containerNoun}
                            onEdit={(lot) => onEditLot(medication, lot)}
                        />
                    </div>
                )}

                {/* Schedule linkage with computed dose volumes */}
                <ScheduleSection medication={medication} schedules={active}/>

                {medication.notes && (
                    <p className="text-muted-foreground line-clamp-2 text-xs">
                        {medication.notes}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
