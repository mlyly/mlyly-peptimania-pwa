"use client";

import * as React from "react";
import {MapPin, TriangleAlert} from "lucide-react";

import {Button} from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {cn} from "@/lib/utils";

/** Which side of the body a map figure depicts. */
type BodyView = "front" | "back";

/**
 * Approximate injection-site vocabulary used by the body map. Labels are
 * stored verbatim in `DoseLog.injectionSite`, so they read naturally in the
 * dose history and edit form.
 *
 * Each figure is labelled R/L for the person's own sides: the front view
 * mirrors them (their right is on the viewer's left), while the back view
 * does not (their right is on the viewer's right).
 */
export const APPROXIMATE_INJECTION_SITES = [
    "Right upper arm",
    "Left upper arm",
    "Right upper abdomen",
    "Left upper abdomen",
    "Right lower abdomen",
    "Left lower abdomen",
    "Right upper thigh",
    "Left upper thigh",
    "Right buttock",
    "Left buttock",
] as const;

export type ApproximateInjectionSite = (typeof APPROXIMATE_INJECTION_SITES)[number];

// ---------------------------------------------------------------------------
// Body map
// ---------------------------------------------------------------------------

interface ZoneProps {
    label: ApproximateInjectionSite;
    selected: boolean;
    onSelect: (label: ApproximateInjectionSite) => void;
    children: React.ReactNode;
}

function Zone({label, selected, onSelect, children}: ZoneProps) {
    const activate = () => onSelect(label);
    return (
        <g
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={selected}
            onClick={activate}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate();
                }
            }}
            className={cn(
                "cursor-pointer outline-none transition-colors",
                selected
                    ? "fill-emerald-500/60 stroke-emerald-600"
                    : "fill-emerald-500/10 stroke-emerald-500/40 hover:fill-emerald-500/25 hover:stroke-emerald-600 focus-visible:fill-emerald-500/30 focus-visible:stroke-emerald-600"
            )}
        >
            <title>{label}</title>
            {children}
        </g>
    );
}

function BodyFigure({
                        view,
                        selected,
                        onSelect,
                    }: {
    view: BodyView;
    selected: ApproximateInjectionSite | null;
    onSelect: (label: ApproximateInjectionSite) => void;
}) {
    const isSelected = (label: ApproximateInjectionSite) => selected === label;
    // A front view mirrors the person (their right is on our left); a back
    // view does not (their right is on our right).
    const viewerLeftSide = view === "front" ? "Right" : "Left";
    const viewerRightSide = view === "front" ? "Left" : "Right";
    const viewerLeftArm = view === "front" ? "Right upper arm" : "Left upper arm";
    const viewerRightArm = view === "front" ? "Left upper arm" : "Right upper arm";
    return (
        <figure className="flex flex-col items-center gap-1.5">
            <div className="flex w-full max-w-[180px] items-center gap-1">
                <span
                    className="text-muted-foreground w-3 shrink-0 text-center text-[10px] font-semibold"
                    aria-hidden
                >
                    {viewerLeftSide.charAt(0)}
                </span>
                <svg
                    viewBox="0 0 220 420"
                    role="group"
                    aria-label={`${view === "front" ? "Front" : "Back"} body map — ${viewerLeftSide.toLowerCase()} side on the left`}
                    className="min-w-0 flex-1"
                >
                    {/* Silhouette */}
                    <g className="fill-muted stroke-border" strokeWidth={1.5}>
                        <circle cx={110} cy={34} r={22}/>
                        <rect x={102} y={54} width={16} height={14} rx={7}/>
                        <path
                            d="M84 78 C96 68 124 68 136 78 L148 178 C130 192 90 192 72 178 Z"/>
                        <path
                            d="M86 80 C72 86 66 102 64 122 L54 174 C52 186 62 190 70 184 L78 148 L92 106 Z"/>
                        <path
                            d="M134 80 C148 86 154 102 156 122 L166 174 C168 186 158 190 150 184 L142 148 L128 106 Z"/>
                        <path
                            d="M84 182 L80 278 L80 352 Q80 368 94 368 Q106 368 106 352 L108 278 L110 196 Z"/>
                        <path
                            d="M136 182 L140 278 L140 352 Q140 368 126 368 Q114 368 114 352 L112 278 L110 196 Z"/>
                    </g>

                    {view === "back" && (
                        <path
                            d="M110 82 L110 180"
                            className="stroke-border"
                            strokeWidth={1}
                            strokeDasharray="3 5"
                            fill="none"
                        />
                    )}

                    {/* Upper arms are reachable from both the front and back. */}
                    <Zone
                        label={viewerLeftArm}
                        selected={isSelected(viewerLeftArm)}
                        onSelect={onSelect}
                    >
                        <ellipse
                            cx={70}
                            cy={118}
                            rx={11}
                            ry={28}
                            transform="rotate(12 70 118)"
                            strokeWidth={1.5}
                        />
                    </Zone>
                    <Zone
                        label={viewerRightArm}
                        selected={isSelected(viewerRightArm)}
                        onSelect={onSelect}
                    >
                        <ellipse
                            cx={150}
                            cy={118}
                            rx={11}
                            ry={28}
                            transform="rotate(-12 150 118)"
                            strokeWidth={1.5}
                        />
                    </Zone>

                    {view === "front" ? (
                        <>
                            <Zone
                                label="Right upper abdomen"
                                selected={isSelected("Right upper abdomen")}
                                onSelect={onSelect}
                            >
                                <rect x={88} y={100} width={20} height={32} rx={8} strokeWidth={1.5}/>
                            </Zone>
                            <Zone
                                label="Left upper abdomen"
                                selected={isSelected("Left upper abdomen")}
                                onSelect={onSelect}
                            >
                                <rect x={112} y={100} width={20} height={32} rx={8} strokeWidth={1.5}/>
                            </Zone>
                            <Zone
                                label="Right lower abdomen"
                                selected={isSelected("Right lower abdomen")}
                                onSelect={onSelect}
                            >
                                <rect x={87} y={138} width={21} height={32} rx={8} strokeWidth={1.5}/>
                            </Zone>
                            <Zone
                                label="Left lower abdomen"
                                selected={isSelected("Left lower abdomen")}
                                onSelect={onSelect}
                            >
                                <rect x={112} y={138} width={21} height={32} rx={8} strokeWidth={1.5}/>
                            </Zone>
                            <Zone
                                label="Right upper thigh"
                                selected={isSelected("Right upper thigh")}
                                onSelect={onSelect}
                            >
                                <rect x={84} y={202} width={24} height={44} rx={11} strokeWidth={1.5}/>
                            </Zone>
                            <Zone
                                label="Left upper thigh"
                                selected={isSelected("Left upper thigh")}
                                onSelect={onSelect}
                            >
                                <rect x={112} y={202} width={24} height={44} rx={11} strokeWidth={1.5}/>
                            </Zone>
                        </>
                    ) : (
                        <>
                            <Zone
                                label="Left buttock"
                                selected={isSelected("Left buttock")}
                                onSelect={onSelect}
                            >
                                <rect x={86} y={184} width={23} height={30} rx={11} strokeWidth={1.5}/>
                            </Zone>
                            <Zone
                                label="Right buttock"
                                selected={isSelected("Right buttock")}
                                onSelect={onSelect}
                            >
                                <rect x={111} y={184} width={23} height={30} rx={11} strokeWidth={1.5}/>
                            </Zone>
                        </>
                    )}
                </svg>
                <span
                    className="text-muted-foreground w-3 shrink-0 text-center text-[10px] font-semibold"
                    aria-hidden
                >
                    {viewerRightSide.charAt(0)}
                </span>
            </div>
            <figcaption className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">
                {view === "front" ? "Front" : "Back"}
            </figcaption>
        </figure>
    );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export interface InjectionSiteDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Name of the medication being logged (shown in the description). */
    medicationName?: string;
    /** Disables the controls while the surrounding checklist is writing. */
    busy?: boolean;
    /**
     * Persists the dose with the selected approximate site (`undefined` when
     * the user skips). Resolve `true` to close the dialog, `false` to keep it
     * open (the caller has already reported the error).
     */
    onConfirm: (site: string | undefined) => Promise<boolean>;
}

/**
 * "Where did you inject?" checkpoint shown when a dose is checked off.
 *
 * The body map records an approximate area (e.g. "Left lower abdomen")
 * rather than an exact point, which is enough to rotate sites over time and
 * is stored in `DoseLog.injectionSite` alongside the dose.
 */
export function InjectionSiteDialog({
                                        open,
                                        onOpenChange,
                                        medicationName,
                                        busy = false,
                                        onConfirm,
                                    }: InjectionSiteDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
                {/* State lives inside the content, which mounts fresh each time
                    the dialog opens — no reset effect needed. */}
                <InjectionSiteDialogBody
                    medicationName={medicationName}
                    busy={busy}
                    onConfirm={onConfirm}
                    onClose={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

function InjectionSiteDialogBody({
                                     medicationName,
                                     busy,
                                     onConfirm,
                                     onClose,
                                 }: {
    medicationName?: string;
    busy: boolean;
    onConfirm: (site: string | undefined) => Promise<boolean>;
    onClose: () => void;
}) {
    const [selected, setSelected] = React.useState<ApproximateInjectionSite | null>(null);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    const toggleSite = (label: ApproximateInjectionSite) => {
        setSelected((current) => (current === label ? null : label));
    };

    const submit = async (site: string | undefined) => {
        if (saving || busy) return;
        setSaving(true);
        setError(null);
        try {
            const logged = await onConfirm(site);
            if (logged) onClose();
        } catch (submitError: unknown) {
            setError(
                submitError instanceof Error
                    ? submitError.message
                    : "Could not log the dose."
            );
        } finally {
            setSaving(false);
        }
    };

    const disabled = saving || busy;

    return (
        <>
            <DialogHeader>
                <DialogTitle>Where did you inject?</DialogTitle>
                <DialogDescription>
                    {medicationName
                        ? `Choose the closest area for ${medicationName}. `
                        : "Choose the closest area. "}
                    The approximate site is saved with this dose.
                </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
                <div className="grid grid-cols-2 gap-3">
                    <BodyFigure view="front" selected={selected} onSelect={toggleSite}/>
                    <BodyFigure view="back" selected={selected} onSelect={toggleSite}/>
                </div>
                <p className="text-muted-foreground text-center text-[11px]">
                    R / L mark the person’s right and left sides.
                </p>

                <div
                    className="bg-muted/40 flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm"
                    aria-live="polite"
                >
                    <MapPin className="text-muted-foreground size-4 shrink-0" aria-hidden/>
                    <span className={cn(!selected && "text-muted-foreground")}>
                        {selected ?? "Tap a highlighted area on the body."}
                    </span>
                </div>
            </div>

            {error && (
                <p className="text-destructive flex items-start gap-1.5 text-sm" role="alert">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden/>
                    {error}
                </p>
            )}

            <DialogFooter className="sm:justify-between">
                <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void submit(undefined)}
                    disabled={disabled}
                >
                    Skip site
                </Button>
                <div className="flex flex-col-reverse gap-2 sm:flex-row">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onClose}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="button"
                        onClick={() => void submit(selected ?? undefined)}
                        disabled={disabled || selected === null}
                    >
                        {saving ? "Logging…" : "Log dose"}
                    </Button>
                </div>
            </DialogFooter>
        </>
    );
}
