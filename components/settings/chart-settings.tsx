"use client";

import * as React from "react";
import {RotateCcw, SlidersHorizontal} from "lucide-react";

import {CHART_RANGES, CONCENTRATION_UNIT_META, CONCENTRATION_UNITS,} from "@/lib/pharmacokinetics/charting";
import {useAppSettings} from "@/lib/settings";
import {cn} from "@/lib/utils";

import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader, CardTitle,} from "@/components/ui/card";
import {Skeleton} from "@/components/ui/skeleton";

/**
 * Feature settings (schema v8 `settings` entries): app-wide defaults for the
 * concentration chart — time range, display unit and which medications are
 * hidden. Values persist to IndexedDB the moment they change and are shared
 * with the chart dashboard through `useAppSettings`.
 */
export function ChartSettings() {
    const {settings, loaded, setSetting, resetSettings} = useAppSettings();

    const hiddenCount = settings["pk.hiddenMedicationIds"].length;

    if (!loaded) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Chart preferences</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4" aria-busy="true">
                    <Skeleton className="h-9 w-full"/>
                    <Skeleton className="h-9 w-2/3"/>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="border-b py-4">
                <CardTitle className="flex items-center gap-2 text-base">
                    <SlidersHorizontal className="size-4" aria-hidden/>
                    Chart preferences
                </CardTitle>
                <CardDescription>
                    Toggleable app features saved on this device. The concentration
                    chart reopens with these settings every time.
                </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 py-4">
                <div className="flex flex-col gap-1.5">
                    <span className="text-muted-foreground text-xs font-medium">
                        Default time range
                    </span>
                    <div
                        role="group"
                        aria-label="Default time range"
                        className="bg-muted/50 flex w-fit max-w-full flex-wrap gap-1 rounded-lg border p-1"
                    >
                        {CHART_RANGES.map((range) => {
                            const active = range.id === settings["pk.chartRange"];
                            return (
                                <Button
                                    key={range.id}
                                    type="button"
                                    size="sm"
                                    variant={active ? "default" : "ghost"}
                                    aria-pressed={active}
                                    onClick={() => void setSetting("pk.chartRange", range.id)}
                                    className={cn(
                                        "h-7 shrink-0 px-2.5 text-xs",
                                        !active && "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {range.label}
                                </Button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex flex-col gap-1.5">
                    <span className="text-muted-foreground text-xs font-medium">
                        Default display unit
                    </span>
                    <div
                        role="group"
                        aria-label="Default display unit"
                        className="bg-muted/50 flex w-fit gap-1 rounded-lg border p-1"
                    >
                        {CONCENTRATION_UNITS.map((option) => {
                            const active = option === settings["pk.chartUnit"];
                            const meta = CONCENTRATION_UNIT_META[option];
                            return (
                                <Button
                                    key={option}
                                    type="button"
                                    size="sm"
                                    variant={active ? "default" : "ghost"}
                                    aria-pressed={active}
                                    title={meta.description}
                                    onClick={() => void setSetting("pk.chartUnit", option)}
                                    className={cn(
                                        "h-7 px-3 text-xs tabular-nums",
                                        !active && "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {meta.label}
                                </Button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
                    <div className="flex min-w-0 flex-col gap-1">
                        <span className="text-xs font-medium">Hidden medications</span>
                        <p className="text-muted-foreground max-w-md text-xs">
                            Curves toggled off on the chart page stay hidden.
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="tabular-nums">
                            {hiddenCount} hidden
                        </Badge>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            disabled={hiddenCount === 0}
                            onClick={() => void setSetting("pk.hiddenMedicationIds", [])}
                        >
                            Show all
                        </Button>
                    </div>
                </div>

                <div className="flex justify-end border-t pt-4">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8"
                        onClick={() => void resetSettings()}
                    >
                        <RotateCcw className="size-3.5" aria-hidden/>
                        Restore defaults
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}
