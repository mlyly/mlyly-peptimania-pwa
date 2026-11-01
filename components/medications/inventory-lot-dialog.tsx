"use client";

import * as React from "react";
import {useForm, useWatch} from "react-hook-form";
import {zodResolver} from "@hookform/resolvers/zod";
import {Trash2, TriangleAlert} from "lucide-react";

import type {DoseUnit} from "@/lib/db/types";
import {DOSE_UNITS, doseUnitLabel} from "@/lib/medications/constants";
import {
    inventoryLotDialogSchema,
    type InventoryLotFormValues,
    newInventoryLotFormValues,
} from "@/lib/medications/schema";
import {formatAmount, formatNumber, formatPrice, parseDecimalInput} from "@/lib/units";

import {Button} from "@/components/ui/button";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,} from "@/components/ui/dialog";
import {Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage,} from "@/components/ui/form";
import {Input} from "@/components/ui/input";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from "@/components/ui/select";
import {Textarea} from "@/components/ui/textarea";

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Unit suffix rendered inside a numeric input field. */
function Suffix({unit}: { unit: string }) {
    return (
        <span
            className="text-muted-foreground pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs tabular-nums">
            {unit}
        </span>
    );
}

// ---------------------------------------------------------------------------
// Form body (mounts fresh for every dialog session via a key)
// ---------------------------------------------------------------------------

interface InventoryLotFormProps {
    lot: InventoryLotFormValues | null;
    isNew: boolean;
    containerNoun: string;
    defaultContentUnit: DoseUnit;
    onSave: (values: InventoryLotFormValues) => void | Promise<void>;
    onRemove?: () => void | Promise<void>;
    onCancel: () => void;
}

function InventoryLotForm({
                              lot,
                              isNew,
                              containerNoun,
                              defaultContentUnit,
                              onSave,
                              onRemove,
                              onCancel,
                          }: InventoryLotFormProps) {
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [confirmRemove, setConfirmRemove] = React.useState(false);

    const defaults = React.useMemo(
        () => lot ?? newInventoryLotFormValues(defaultContentUnit),
        [lot, defaultContentUnit]
    );
    const form = useForm<InventoryLotFormValues>({
        resolver: zodResolver(inventoryLotDialogSchema),
        defaultValues: defaults,
    });

    const watchedValues = useWatch({control: form.control});
    const watched = {
        ...defaults,
        ...(watchedValues ?? {}),
    } as InventoryLotFormValues;

    const vials = parseDecimalInput(watched.vialCount) ?? 0;
    const content = parseDecimalInput(watched.contentAmount) ?? 0;
    const price = parseDecimalInput(watched.pricePerContainer);
    const total = vials > 0 && content > 0 ? vials * content : 0;
    const lotPrice =
        price !== undefined && price >= 0 && vials > 0 ? vials * price : null;

    const submit = async (values: InventoryLotFormValues) => {
        setSaving(true);
        setError(null);
        try {
            await onSave(values);
            onCancel();
        } catch (submitError: unknown) {
            setError(errorMessage(submitError));
            setSaving(false);
        }
    };

    const remove = async () => {
        if (!onRemove) return;
        setSaving(true);
        setError(null);
        try {
            await onRemove();
            onCancel();
        } catch (removeError: unknown) {
            setError(errorMessage(removeError));
            setSaving(false);
            setConfirmRemove(false);
        }
    };

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit(submit)}
                className="flex flex-col gap-4"
                noValidate
            >
                <p className="bg-muted/30 rounded-lg border px-3 py-2.5 text-xs">
                    {total > 0 ? (
                        <>
                            <span className="font-medium">Lot total</span>{" "}
                            <span className="tabular-nums font-medium">
                                {formatNumber(vials)} ×{" "}
                                {formatAmount(content, watched.contentUnit)} ={" "}
                                {formatAmount(total, watched.contentUnit)}
                            </span>
                            {lotPrice !== null && (
                                <span className="text-muted-foreground">
                                    {" "}
                                    · value {formatPrice(lotPrice)}
                                </span>
                            )}
                        </>
                    ) : (
                        <span className="text-muted-foreground">
                            Enter the number of containers and how much each one
                            holds.
                        </span>
                    )}
                </p>

                <div className="grid gap-3 sm:grid-cols-3">
                    <FormField
                        control={form.control}
                        name="vialCount"
                        render={({field}) => (
                            <FormItem>
                                <FormLabel className="text-xs">
                                    Number of {containerNoun}s
                                </FormLabel>
                                <FormControl>
                                    <Input
                                        inputMode="numeric"
                                        placeholder="1"
                                        className="tabular-nums"
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage/>
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="contentAmount"
                        render={({field}) => (
                            <FormItem>
                                <FormLabel className="text-xs">
                                    Content per {containerNoun}
                                </FormLabel>
                                <FormControl>
                                    <Input
                                        inputMode="decimal"
                                        placeholder="5"
                                        className="tabular-nums"
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage/>
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="contentUnit"
                        render={({field}) => (
                            <FormItem>
                                <FormLabel className="text-xs">
                                    Content unit
                                </FormLabel>
                                <Select onValueChange={field.onChange} value={field.value}>
                                    <FormControl>
                                        <SelectTrigger className="w-full">
                                            <SelectValue/>
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        {DOSE_UNITS.map((value) => (
                                            <SelectItem key={value} value={value}>
                                                {doseUnitLabel(value)}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <FormMessage/>
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="orderDate"
                        render={({field}) => (
                            <FormItem>
                                <FormLabel className="text-xs">
                                    Order date{" "}
                                    <span className="text-muted-foreground font-normal">
                                        (optional)
                                    </span>
                                </FormLabel>
                                <FormControl>
                                    <Input
                                        type="date"
                                        className="tabular-nums"
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage/>
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="deliveryDate"
                        render={({field}) => (
                            <FormItem>
                                <FormLabel className="text-xs">
                                    Delivery date{" "}
                                    <span className="text-muted-foreground font-normal">
                                        (optional)
                                    </span>
                                </FormLabel>
                                <FormControl>
                                    <Input
                                        type="date"
                                        className="tabular-nums"
                                        {...field}
                                    />
                                </FormControl>
                                <FormMessage/>
                            </FormItem>
                        )}
                    />
                </div>

                <FormField
                    control={form.control}
                    name="vendor"
                    render={({field}) => (
                        <FormItem>
                            <FormLabel className="text-xs">
                                Vendor{" "}
                                <span className="text-muted-foreground font-normal">
                                    (optional)
                                </span>
                            </FormLabel>
                            <FormControl>
                                <Input
                                    placeholder="Vendor / supplier, batch info…"
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage/>
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="pricePerContainer"
                    render={({field}) => (
                        <FormItem>
                            <FormLabel className="text-xs">
                                Price per {containerNoun}{" "}
                                <span className="text-muted-foreground font-normal">
                                    (optional)
                                </span>
                            </FormLabel>
                            <div className="relative">
                                <FormControl>
                                    <Input
                                        inputMode="decimal"
                                        placeholder="29.99"
                                        className="pr-8 tabular-nums"
                                        {...field}
                                    />
                                </FormControl>
                                <Suffix unit="$"/>
                            </div>
                            <FormDescription className="text-xs">
                                USD per {containerNoun}, not per content unit.
                            </FormDescription>
                            <FormMessage/>
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="coaUrlsText"
                    render={({field}) => (
                        <FormItem>
                            <FormLabel className="text-xs">
                                COA links{" "}
                                <span className="text-muted-foreground font-normal">
                                    (optional)
                                </span>
                            </FormLabel>
                            <FormControl>
                                <Textarea
                                    rows={2}
                                    placeholder="https://example.com/coa.pdf (one per line)"
                                    className="resize-none text-xs"
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage/>
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="notes"
                    render={({field}) => (
                        <FormItem>
                            <FormLabel className="text-xs">
                                Lot note{" "}
                                <span className="text-muted-foreground font-normal">
                                    (optional)
                                </span>
                            </FormLabel>
                            <FormControl>
                                <Input
                                    placeholder="Batch, storage, appearance…"
                                    {...field}
                                />
                            </FormControl>
                            <FormMessage/>
                        </FormItem>
                    )}
                />

                {error && (
                    <p
                        className="text-destructive flex items-start gap-1.5 text-sm"
                        role="alert"
                    >
                        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden/>
                        {error}
                    </p>
                )}

                {onRemove && (
                    <div className="border-destructive/30 bg-destructive/5 rounded-lg border px-3 py-2">
                        {confirmRemove ? (
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="text-destructive flex-1 text-xs">
                                    Remove this lot? This can’t be undone.
                                </span>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setConfirmRemove(false)}
                                    disabled={saving}
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => void remove()}
                                    disabled={saving}
                                >
                                    Remove
                                </Button>
                            </div>
                        ) : (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive h-7 px-2"
                                onClick={() => setConfirmRemove(true)}
                                disabled={saving}
                            >
                                <Trash2 className="size-3.5" aria-hidden/>
                                Remove lot
                            </Button>
                        )}
                    </div>
                )}

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button
                        type="button"
                        variant="outline"
                        onClick={onCancel}
                        disabled={saving}
                    >
                        Cancel
                    </Button>
                    <Button type="submit" disabled={saving}>
                        {saving ? "Saving…" : isNew ? "Add lot" : "Save lot"}
                    </Button>
                </div>
            </form>
        </Form>
    );
}

// ---------------------------------------------------------------------------
// Dialog shell
// ---------------------------------------------------------------------------

export interface InventoryLotDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Lot being edited (or the blank row for a new lot). */
    lot: InventoryLotFormValues | null;
    /** True when the dialog creates a lot rather than editing one. */
    isNew?: boolean;
    /** Noun for one container, e.g. "vial" or "bottle". */
    containerNoun: string;
    /** Default content unit for new lots. */
    defaultContentUnit?: DoseUnit;
    onSave: (values: InventoryLotFormValues) => void | Promise<void>;
    /** Present when the lot can be removed. */
    onRemove?: () => void | Promise<void>;
}

export function InventoryLotDialog({
                                       open,
                                       onOpenChange,
                                       lot,
                                       isNew = false,
                                       containerNoun,
                                       defaultContentUnit = "mg",
                                       onSave,
                                       onRemove,
                                   }: InventoryLotDialogProps) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {isNew ? "Add inventory lot" : "Edit inventory lot"}
                    </DialogTitle>
                    <DialogDescription>
                        Track containers, content, dates, vendor, price and COA links
                        for one purchase or delivery.
                    </DialogDescription>
                </DialogHeader>

                {open && (
                    <InventoryLotForm
                        key={isNew ? "new" : lot?.id ?? "new"}
                        lot={lot}
                        isNew={isNew}
                        containerNoun={containerNoun}
                        defaultContentUnit={defaultContentUnit}
                        onSave={onSave}
                        onRemove={onRemove}
                        onCancel={() => onOpenChange(false)}
                    />
                )}
            </DialogContent>
        </Dialog>
    );
}
