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
    "Right upper love handle",
    "Right upper abdomen",
    "Left upper abdomen",
    "Left upper love handle",
    "Right lower love handle",
    "Right lower abdomen",
    "Left lower abdomen",
    "Left lower love handle",
    "Right upper thigh",
    "Right lower thigh",
    "Left upper thigh",
    "Left lower thigh",
    "Right buttock",
    "Left buttock",
] as const;

export type ApproximateInjectionSite = (typeof APPROXIMATE_INJECTION_SITES)[number];

/** Narrows a stored site string to one of the body-map labels. */
export function isApproximateInjectionSite(value: string): value is ApproximateInjectionSite {
    return (APPROXIMATE_INJECTION_SITES as readonly string[]).includes(value);
}

/**
 * The abdomen's four columns, viewer-left to viewer-right on the front view:
 * right love handle, right abdomen, left abdomen, left love handle. Each
 * column has an upper and a lower zone.
 */
const ABDOMEN_COLUMNS = [
    {x: 83, upper: "Right upper love handle", lower: "Right lower love handle"},
    {x: 96, upper: "Right upper abdomen", lower: "Right lower abdomen"},
    {x: 109, upper: "Left upper abdomen", lower: "Left lower abdomen"},
    {x: 122, upper: "Left upper love handle", lower: "Left lower love handle"},
] as const satisfies readonly {
    x: number;
    upper: ApproximateInjectionSite;
    lower: ApproximateInjectionSite;
}[];

const EMPTY_RECENT_SITES: readonly string[] = [];

type SiteRegion = "abdomen" | "arm" | "thigh" | "buttock";

/**
 * Whether a stored site string refers to a given map region. Exact labels
 * match directly; older generic presets ("Abdomen", "Thigh", "Upper arm",
 * "Left thigh", …) fan out to every matching map zone.
 */
function matchesInjectionSite(storedSite: string, label: ApproximateInjectionSite): boolean {
    const stored = storedSite.trim().toLowerCase();
    const zone = label.toLowerCase();
    if (!stored) return false;
    if (stored === zone) return true;

    const storedRegion: SiteRegion | null =
        stored.includes("love handle") ||
        stored.includes("abdomen") ||
        stored.includes("belly")
            ? "abdomen"
            : stored.includes("arm")
                ? "arm"
                : stored.includes("thigh")
                    ? "thigh"
                    : stored.includes("buttock") || stored.includes("glute")
                        ? "buttock"
                        : null;

    const zoneRegion: SiteRegion | null =
        zone.includes("love handle") || zone.includes("abdomen")
            ? "abdomen"
            : zone.includes("arm")
                ? "arm"
                : zone.includes("thigh")
                    ? "thigh"
                    : zone.includes("buttock")
                        ? "buttock"
                        : null;

    if (!storedRegion || storedRegion !== zoneRegion) return false;

    // "Love handle" is a flank, not the central abdomen strip.
    if (stored.includes("love handle") && !zone.includes("love handle")) return false;

    const storedSide = stored.includes("left")
        ? "left"
        : stored.includes("right")
            ? "right"
            : null;
    if (storedSide && !zone.includes(storedSide)) return false;

    if (zoneRegion !== "buttock") {
        const storedLevel = stored.includes("upper")
            ? "upper"
            : stored.includes("lower")
                ? "lower"
                : null;
        if (storedLevel && !zone.includes(storedLevel)) return false;
    }

    return true;
}

// ---------------------------------------------------------------------------
// Body map
// ---------------------------------------------------------------------------

interface ZoneProps {
    label: ApproximateInjectionSite;
    selected: boolean;
    usedRecently: boolean;
    onSelect: (label: ApproximateInjectionSite) => void;
    children: React.ReactNode;
}

function Zone({label, selected, usedRecently, onSelect, children}: ZoneProps) {
    const activate = () => onSelect(label);
    return (
        <g
            role="button"
            tabIndex={0}
            aria-label={`${label}${usedRecently ? " — used in the last 7 days" : ""}`}
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
                    : usedRecently
                        ? "fill-red-500/40 stroke-red-500/70 hover:fill-red-500/55 focus-visible:fill-red-500/55 focus-visible:stroke-red-600"
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
                        recentLabels,
                        onSelect,
                    }: {
    view: BodyView;
    selected: ApproximateInjectionSite | null;
    recentLabels: ReadonlySet<ApproximateInjectionSite>;
    onSelect: (label: ApproximateInjectionSite) => void;
}) {
    const isSelected = (label: ApproximateInjectionSite) => selected === label;
    const isRecent = (label: ApproximateInjectionSite) => recentLabels.has(label);
    // A front view mirrors the person (their right is on our left); a back
    // view does not (their right is on our right).
    const viewerLeftSide = view === "front" ? "Right" : "Left";
    const viewerRightSide = view === "front" ? "Left" : "Right";
    const viewerLeftArm = view === "front" ? "Right upper arm" : "Left upper arm";
    const viewerRightArm = view === "front" ? "Left upper arm" : "Right upper arm";
    return (
        <figure className="flex flex-col items-center gap-1.5">
            <div className="flex w-full max-w-[220px] items-center gap-1 sm:max-w-[180px]">
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
                        usedRecently={isRecent(viewerLeftArm)}
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
                        usedRecently={isRecent(viewerRightArm)}
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
                            {ABDOMEN_COLUMNS.map((column) => (
                                <React.Fragment key={column.x}>
                                    <Zone
                                        label={column.upper}
                                        selected={isSelected(column.upper)}
                                        usedRecently={isRecent(column.upper)}
                                        onSelect={onSelect}
                                    >
                                        <rect
                                            x={column.x}
                                            y={110}
                                            width={12}
                                            height={32}
                                            rx={6}
                                            strokeWidth={1.5}
                                        />
                                    </Zone>
                                    <Zone
                                        label={column.lower}
                                        selected={isSelected(column.lower)}
                                        usedRecently={isRecent(column.lower)}
                                        onSelect={onSelect}
                                    >
                                        <rect
                                            x={column.x}
                                            y={144}
                                            width={12}
                                            height={32}
                                            rx={6}
                                            strokeWidth={1.5}
                                        />
                                    </Zone>
                                </React.Fragment>
                            ))}
                            <Zone
                                label="Right upper thigh"
                                selected={isSelected("Right upper thigh")}
                                usedRecently={isRecent("Right upper thigh")}
                                onSelect={onSelect}
                            >
                                <rect x={84} y={201} width={24} height={23} rx={10} strokeWidth={1.5}/>
                            </Zone>
                            <Zone
                                label="Left upper thigh"
                                selected={isSelected("Left upper thigh")}
                                usedRecently={isRecent("Left upper thigh")}
                                onSelect={onSelect}
                            >
                                <rect x={112} y={201} width={24} height={23} rx={10} strokeWidth={1.5}/>
                            </Zone>
                            <Zone
                                label="Right lower thigh"
                                selected={isSelected("Right lower thigh")}
                                usedRecently={isRecent("Right lower thigh")}
                                onSelect={onSelect}
                            >
                                <rect x={84} y={228} width={24} height={33} rx={10} strokeWidth={1.5}/>
                            </Zone>
                            <Zone
                                label="Left lower thigh"
                                selected={isSelected("Left lower thigh")}
                                usedRecently={isRecent("Left lower thigh")}
                                onSelect={onSelect}
                            >
                                <rect x={112} y={228} width={24} height={33} rx={10} strokeWidth={1.5}/>
                            </Zone>
                        </>
                    ) : (
                        <>
                            <Zone
                                label="Left buttock"
                                selected={isSelected("Left buttock")}
                                usedRecently={isRecent("Left buttock")}
                                onSelect={onSelect}
                            >
                                <rect x={86} y={184} width={23} height={30} rx={11} strokeWidth={1.5}/>
                            </Zone>
                            <Zone
                                label="Right buttock"
                                selected={isSelected("Right buttock")}
                                usedRecently={isRecent("Right buttock")}
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
    /** Dialog heading. Defaults to "Where did you inject?". */
    title?: string;
    /** Label for the confirm button. Defaults to "Log dose". */
    confirmLabel?: string;
    /** Label for the skip button. Defaults to "Skip site". */
    skipLabel?: string;
    /** Site to pre-select when used as a picker. */
    initialSite?: ApproximateInjectionSite | null;
    /** Name of the medication being logged (shown in the description). */
    medicationName?: string;
    /** Disables the controls while the surrounding checklist is writing. */
    busy?: boolean;
    /**
     * Injection sites recorded in the last week (all medications). Matching
     * map regions are highlighted red so sites can be rotated.
     */
    recentSites?: readonly string[];
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
                                        title = "Where did you inject?",
                                        confirmLabel = "Log dose",
                                        skipLabel = "Skip site",
                                        initialSite = null,
                                        medicationName,
                                        busy = false,
                                        recentSites = EMPTY_RECENT_SITES,
                                        onConfirm,
                                    }: InjectionSiteDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
                {/* State lives inside the content, which mounts fresh each time
                    the dialog opens — no reset effect needed. */}
                <InjectionSiteDialogBody
                    title={title}
                    confirmLabel={confirmLabel}
                    skipLabel={skipLabel}
                    initialSite={initialSite}
                    medicationName={medicationName}
                    busy={busy}
                    recentSites={recentSites}
                    onConfirm={onConfirm}
                    onClose={() => onOpenChange(false)}
                />
            </DialogContent>
        </Dialog>
    );
}

function InjectionSiteDialogBody({
                                     title,
                                     confirmLabel,
                                     skipLabel,
                                     initialSite,
                                     medicationName,
                                     busy,
                                     recentSites,
                                     onConfirm,
                                     onClose,
                                 }: {
    title: string;
    confirmLabel: string;
    skipLabel: string;
    initialSite: ApproximateInjectionSite | null;
    medicationName?: string;
    busy: boolean;
    recentSites: readonly string[];
    onConfirm: (site: string | undefined) => Promise<boolean>;
    onClose: () => void;
}) {
    const [selected, setSelected] = React.useState<ApproximateInjectionSite | null>(initialSite);
    const [activeView, setActiveView] = React.useState<BodyView>("front");
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);

    // Map stored site strings (including older generic presets) onto the
    // zones this body map knows about.
    const recentZoneLabels = React.useMemo(() => {
        const labels = new Set<ApproximateInjectionSite>();
        for (const site of recentSites) {
            for (const label of APPROXIMATE_INJECTION_SITES) {
                if (matchesInjectionSite(site, label)) labels.add(label);
            }
        }
        return labels;
    }, [recentSites]);

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
                <DialogTitle>{title}</DialogTitle>
                <DialogDescription>
                    {medicationName
                        ? `Choose the closest area for ${medicationName}. `
                        : "Choose the closest area. "}
                    The approximate site is saved with this dose.
                </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-3">
                {/* Mobile shows one body side at a time; desktop shows both. */}
                <div className="bg-muted grid grid-cols-2 gap-1 rounded-lg p-1 sm:hidden">
                    <Button
                        type="button"
                        size="sm"
                        variant={activeView === "front" ? "secondary" : "ghost"}
                        className="h-8"
                        onClick={() => setActiveView("front")}
                        aria-pressed={activeView === "front"}
                    >
                        Front
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant={activeView === "back" ? "secondary" : "ghost"}
                        className="h-8"
                        onClick={() => setActiveView("back")}
                        aria-pressed={activeView === "back"}
                    >
                        Back
                    </Button>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className={cn(activeView !== "front" && "hidden sm:block")}>
                        <BodyFigure
                            view="front"
                            selected={selected}
                            recentLabels={recentZoneLabels}
                            onSelect={toggleSite}
                        />
                    </div>
                    <div className={cn(activeView !== "back" && "hidden sm:block")}>
                        <BodyFigure
                            view="back"
                            selected={selected}
                            recentLabels={recentZoneLabels}
                            onSelect={toggleSite}
                        />
                    </div>
                </div>
                <div
                    className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[11px]">
                    <span>R / L mark the person’s right and left sides.</span>
                    {recentZoneLabels.size > 0 && (
                        <span className="inline-flex items-center gap-1">
                            <span
                                className="border-red-500/70 bg-red-500/40 inline-block size-2.5 rounded-sm border"
                                aria-hidden
                            />
                            Used in the last 7 days
                        </span>
                    )}
                </div>

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
                    {skipLabel}
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
                        {saving ? "Logging…" : confirmLabel}
                    </Button>
                </div>
            </DialogFooter>
        </>
    );
}
