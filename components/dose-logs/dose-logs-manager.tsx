"use client";

import * as React from "react";
import Link from "next/link";
import {AlertCircle, ClipboardList, Plus, Search, SearchX,} from "lucide-react";

import type {DoseLog} from "@/lib/db/types";
import {storageAwareMessage} from "@/lib/db/quota";
import {deleteDoseLog} from "@/lib/scheduling/service";
import {recentInjectionSites} from "@/lib/scheduling/derived";
import {toast} from "@/lib/toast";

import {ConfirmDialog} from "@/components/app/confirm-dialog";
import {ListPager} from "@/components/app/list-pager";
import {usePagedTable} from "@/components/app/use-paged-table";
import {Badge} from "@/components/ui/badge";
import {Button} from "@/components/ui/button";
import {Card, CardContent} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from "@/components/ui/select";
import {Skeleton} from "@/components/ui/skeleton";

import {medicationIndex, useTrackerData} from "@/components/scheduling/use-tracker-data";

import {DoseLogFormDialog} from "./dose-log-form-dialog";
import {DoseLogRow} from "./dose-log-row";

// ---------------------------------------------------------------------------
// State helpers
// ---------------------------------------------------------------------------

type OriginFilter = "all" | "scheduled" | "adhoc";

interface DeleteTarget {
    log: DoseLog;
    medicationName: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Dose history surface: search/filter, a paginated, compact one-line-per-dose
 * list of every logged dose (scheduled check-offs and one-offs) and the
 * log/edit/delete dialogs. Page size is stored per table in settings. Boots
 * the local database via `useTrackerData` and reloads after each write.
 */
export function DoseLogsManager() {
    const {phase, data, reload} = useTrackerData();

    const [query, setQuery] = React.useState("");
    const [medicationFilter, setMedicationFilter] = React.useState("all");
    const [originFilter, setOriginFilter] = React.useState<OriginFilter>("all");

    const [busyId, setBusyId] = React.useState<string | null>(null);

    const [formOpen, setFormOpen] = React.useState(false);
    const [editing, setEditing] = React.useState<DoseLog | null>(null);
    const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget | null>(null);

    const reportError = React.useCallback((error: unknown, prefix: string) => {
        toast.error(storageAwareMessage(error, prefix));
    }, []);

    // -- Handlers ----------------------------------------------------------

    const onChanged = React.useCallback(() => {
        void reload();
    }, [reload]);

    const recentSites = React.useMemo(
        () => recentInjectionSites(data.doseLogs),
        [data.doseLogs]
    );

    const openCreate = React.useCallback(() => {
        setEditing(null);
        setFormOpen(true);
    }, []);

    const openEdit = React.useCallback((log: DoseLog) => {
        setEditing(log);
        setFormOpen(true);
    }, []);

    const medications = React.useMemo(
        () => medicationIndex(data.medications),
        [data.medications]
    );

    const handleDoseSaved = React.useCallback(
        (saved: DoseLog, mode: "created" | "updated") => {
            const name = medications.get(saved.medicationId)?.name;
            toast.success(
                mode === "created"
                    ? `${name ? `${name} ` : ""}dose logged.`
                    : "Dose updated."
            );
            onChanged();
        },
        [medications, onChanged]
    );

    const requestDelete = React.useCallback(
        (log: DoseLog) => {
            setDeleteTarget({
                log,
                medicationName: medications.get(log.medicationId)?.name ?? null,
            });
        },
        [medications]
    );

    const confirmDelete = React.useCallback(async () => {
        if (!deleteTarget) return;
        setBusyId(deleteTarget.log.id);
        try {
            await deleteDoseLog(deleteTarget.log.id);
            toast.success("Dose log deleted.");
            setDeleteTarget(null);
            onChanged();
        } catch (error: unknown) {
            reportError(error, "Delete failed");
            setDeleteTarget(null);
        } finally {
            setBusyId(null);
        }
    }, [deleteTarget, onChanged, reportError]);

    // -- Derived view state ------------------------------------------------

    const summary = React.useMemo(() => {
        const scheduled = data.doseLogs.filter((log) => log.scheduleId !== undefined).length;
        return {total: data.doseLogs.length, scheduled};
    }, [data.doseLogs]);

    const visibleLogs = React.useMemo<DoseLog[]>(() => {
        const needle = query.trim().toLowerCase();
        return data.doseLogs.filter((log) => {
            if (medicationFilter !== "all" && log.medicationId !== medicationFilter) {
                return false;
            }
            if (originFilter === "scheduled" && log.scheduleId === undefined) {
                return false;
            }
            if (originFilter === "adhoc" && log.scheduleId !== undefined) {
                return false;
            }
            if (needle === "") return true;
            const medication = medications.get(log.medicationId);
            return [medication?.name, log.injectionSite, log.notes]
                .filter(Boolean)
                .some((text) => text!.toLowerCase().includes(needle));
        });
    }, [data.doseLogs, medications, query, medicationFilter, originFilter]);

    const paged = usePagedTable("doseLogs", visibleLogs,
        `${query}|${medicationFilter}|${originFilter}`);

    const hasMedications = data.medications.length > 0;

    // -- Render ------------------------------------------------------------

    if (phase.phase === "error") {
        return (
            <Card className="border-destructive/50">
                <CardContent className="text-destructive flex items-start gap-2 px-4 text-sm">
                    <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden/>
                    <span>Database error: {phase.message}</span>
                </CardContent>
            </Card>
        );
    }

    if (phase.phase === "loading") {
        return (
            <div className="flex flex-col gap-3">
                <Skeleton className="h-10 w-full rounded-xl"/>
                <Skeleton className="h-64 w-full rounded-xl"/>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-36 flex-1">
                    <Search
                        className="text-muted-foreground pointer-events-none absolute inset-y-0 left-3 my-auto size-4"
                        aria-hidden
                    />
                    <Input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="Search name, site or notes…"
                        aria-label="Search dose logs"
                        className="pl-9"
                    />
                </div>
                <Select value={medicationFilter} onValueChange={setMedicationFilter}>
                    <SelectTrigger aria-label="Filter by medication" className="w-36">
                        <SelectValue/>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All medications</SelectItem>
                        {data.medications.map((medication) => (
                            <SelectItem key={medication.id} value={medication.id}>
                                {medication.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select
                    value={originFilter}
                    onValueChange={(value) => setOriginFilter(value as OriginFilter)}
                >
                    <SelectTrigger aria-label="Filter by origin" className="w-36">
                        <SelectValue/>
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All origins</SelectItem>
                        <SelectItem value="scheduled">From schedules</SelectItem>
                        <SelectItem value="adhoc">One-off doses</SelectItem>
                    </SelectContent>
                </Select>
                <Button onClick={openCreate} disabled={!hasMedications}>
                    <Plus className="size-4" aria-hidden/>
                    Log dose
                </Button>
            </div>

            {/* Summary chips */}
            <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary" className="tabular-nums">
                    {summary.total} {summary.total === 1 ? "dose" : "doses"}
                </Badge>
                {summary.scheduled > 0 && (
                    <Badge variant="outline" className="tabular-nums">
                        {summary.scheduled} from schedules
                    </Badge>
                )}
            </div>

            {/* Pagination — page size persists per table in settings */}
            {paged.showPager && (
                <ListPager
                    pageSize={paged.pageSize}
                    onPageSizeChange={paged.setPageSize}
                    page={paged.page}
                    pageCount={paged.pageCount}
                    onPageChange={paged.setPage}
                    rangeStart={paged.rangeStart}
                    rangeEnd={paged.rangeEnd}
                    totalItems={paged.totalItems}
                    itemNoun="doses"
                />
            )}

            {/* Compact history — one line per dose, newest first */}
            {paged.totalItems > 0 ? (
                <div className="flex flex-col gap-1.5">
                    {paged.items.map((log) => (
                        <DoseLogRow
                            key={log.id}
                            log={log}
                            medication={medications.get(log.medicationId) ?? null}
                            onEdit={openEdit}
                            onDelete={requestDelete}
                            busy={busyId === log.id}
                        />
                    ))}
                </div>
            ) : data.doseLogs.length === 0 ? (
                <Card className="border-dashed">
                    <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                        <div className="bg-muted rounded-full border p-3">
                            <ClipboardList className="text-muted-foreground size-6" aria-hidden/>
                        </div>
                        <div>
                            <p className="text-sm font-medium">No dose logs yet</p>
                            <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                                {hasMedications
                                    ? "Log a one-off dose here, or check off scheduled doses from Today — both land in this history."
                                    : "Add a medication first, then log its doses."}
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                            <Button onClick={openCreate} disabled={!hasMedications}>
                                <Plus className="size-4" aria-hidden/>
                                Log a dose
                            </Button>
                            {!hasMedications && (
                                <Button asChild variant="outline">
                                    <Link href="/medications">Add a medication</Link>
                                </Button>
                            )}
                        </div>
                    </CardContent>
                </Card>
            ) : (
                <div
                    className="text-muted-foreground flex items-center justify-center gap-2 rounded-xl border border-dashed py-10 text-sm">
                    <SearchX className="size-4" aria-hidden/>
                    No dose logs match your search or filters.
                </div>
            )}

            <DoseLogFormDialog
                open={formOpen}
                onOpenChange={setFormOpen}
                log={editing}
                medications={data.medications}
                schedules={data.schedules}
                recentSites={recentSites}
                onSaved={handleDoseSaved}
            />

            <ConfirmDialog
                open={deleteTarget !== null}
                destructive
                busy={deleteTarget !== null && busyId === deleteTarget.log.id}
                title="Delete dose log?"
                description={
                    deleteTarget && (
                        <span>
                            The{" "}
                            <strong className="text-foreground">
                                {deleteTarget.medicationName ?? "dose"}
                            </strong>{" "}
                            record will be removed from your history. Inventory is not
                            affected. This cannot be undone.
                        </span>
                    )
                }
                confirmLabel="Delete"
                onConfirm={() => void confirmDelete()}
                onCancel={() => setDeleteTarget(null)}
            />
        </div>
    );
}
