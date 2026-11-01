"use client";

/**
 * First-run Terms of Service gate.
 *
 * On app start (and every 30 days after an acceptance — see
 * `lib/legal/terms.ts`) this overlay covers the app and shows TERMS.md.
 * The user must tick "I have read and agree" before the Continue button
 * enables; clicking it records `legal.termsAcceptedAt` in the settings
 * store (IndexedDB) and dismisses the gate until the next app start.
 *
 * Rendered from the root layout. It returns `null` until the settings
 * snapshot has loaded, so it never flashes during normal use and never
 * appears in the prerendered static HTML.
 */
import * as React from "react";
import {TriangleAlert} from "lucide-react";

import {Button} from "@/components/ui/button";
import {Checkbox} from "@/components/ui/checkbox";
import {Label} from "@/components/ui/label";
import {useHydrated} from "@/lib/hooks/use-hydrated";
import {needsTermsAcceptance, TERMS_URL} from "@/lib/legal/terms";
import {type AppSettings, useAppSettings} from "@/lib/settings";

/** Condensed fallback shown when TERMS.md cannot be fetched (offline, pre-SW). */
const FALLBACK_TERMS = `# Terms of Service & Legal Disclaimer

AS IS / AS AVAILABLE — no warranties of any kind, express or implied.
NO LIABILITY: the authors accept no responsibility of any kind for anything arising from your use of this app, including health consequences, data loss, or damages of any type.
NO ENDORSEMENT: this app does not endorse, recommend, or encourage the use of peptides, medications, or any other substance, and provides no medical advice. All calculations are approximations you must verify yourself.
FREE SOFTWARE, NO COPYRIGHT: you may use, copy, modify, distribute, and sell this software for any purpose without permission or attribution.

By continuing you confirm you have read and accept the full TERMS.md shipped with the app.`;

export function TermsGate() {
    const hydrated = useHydrated();
    const {settings, loaded, setSetting} = useAppSettings();
    const show = hydrated && needsTermsAcceptance(settings["legal.termsAcceptedAt"], loaded);
    if (!show) return null;
    // Mounted fresh every time the gate shows, so its agreement/fetch state
    // starts clean without any effect-driven resets.
    return <TermsDialog setSetting={setSetting}/>;
}

function TermsDialog({setSetting}: {
    setSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
}) {
    const [agreed, setAgreed] = React.useState(false);
    const [terms, setTerms] = React.useState<string | null>(null);
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
        let active = true;
        fetch(TERMS_URL)
            .then((response) => (response.ok ? response.text() : Promise.reject(new Error("missing"))))
            .then((text) => active && setTerms(text))
            .catch(() => active && setTerms(FALLBACK_TERMS));
        return () => {
            active = false;
        };
    }, []);

    async function accept(): Promise<void> {
        setSaving(true);
        try {
            // The settings store updates optimistically, so the gate unmounts
            // as soon as the write is issued; a failed persist re-syncs and
            // the gate re-appears on the next load.
            await setSetting("legal.termsAcceptedAt", new Date().toISOString());
        } finally {
            setSaving(false);
        }
    }

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="terms-gate-title"
            className="fixed inset-0 z-50 overflow-y-auto bg-background"
        >
            <div
                className="mx-auto flex min-h-full w-full max-w-2xl flex-col px-4 pb-8"
                style={{
                    // Fixed overlays sit outside the body flow — clear the
                    // notch/edge-to-edge status bar themselves.
                    paddingTop: "calc(2rem + env(safe-area-inset-top))",
                }}
            >
                <header className="flex items-start gap-3">
                    <TriangleAlert className="mt-1 size-6 shrink-0 text-amber-500" aria-hidden/>
                    <div>
                        <h1 id="terms-gate-title" className="text-xl font-semibold tracking-tight">
                            Terms of Service &amp; Legal Disclaimer
                        </h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Please read the terms below and confirm your agreement before using Peptimania.
                        </p>
                    </div>
                </header>

                <div
                    className="mt-4 flex-1 overflow-y-auto rounded-md border bg-muted/30 p-4"
                    style={{maxHeight: "55vh"}}
                >
                    {terms === null ? (
                        <p className="text-sm text-muted-foreground">Loading terms…</p>
                    ) : (
                        <TermsMarkdown source={terms}/>
                    )}
                </div>

                <div className="mt-6 flex flex-col gap-4">
                    <div className="flex items-start gap-3">
                        <Checkbox
                            id="terms-agree"
                            checked={agreed}
                            onCheckedChange={(checked) => setAgreed(checked === true)}
                        />
                        <Label htmlFor="terms-agree" className="text-sm font-medium leading-none cursor-pointer">
                            I have read and agree to the Terms of Service and Legal Disclaimer.
                            I understand this app provides no medical advice, comes with no warranty,
                            and that I use it entirely at my own risk.
                        </Label>
                    </div>
                    <Button disabled={!agreed || saving} onClick={() => void accept()} className="self-end">
                        {saving ? "Saving…" : "Continue"}
                    </Button>
                </div>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Minimal markdown rendering (headings, lists, blockquotes, bold, rules) —
// enough structure for TERMS.md without pulling in a markdown dependency.
// ---------------------------------------------------------------------------

function TermsMarkdown({source}: { source: string }) {
    const lines = source.split("\n");
    return (
        <div className="space-y-2 text-sm leading-relaxed">
            {lines.map((line, index) => {
                const trimmed = line.trim();
                if (trimmed === "") return null;
                if (trimmed === "---") return <hr key={index} className="my-3 border"/>;
                if (trimmed.startsWith("#### ")) return <Heading key={index} level={4} text={trimmed.slice(5)}/>;
                if (trimmed.startsWith("### ")) return <Heading key={index} level={3} text={trimmed.slice(4)}/>;
                if (trimmed.startsWith("## ")) return <Heading key={index} level={2} text={trimmed.slice(3)}/>;
                if (trimmed.startsWith("# ")) return <Heading key={index} level={1} text={trimmed.slice(2)}/>;
                if (trimmed.startsWith("> ")) {
                    return (
                        <blockquote key={index}
                                    className="border-l-2 border-muted-foreground/40 pl-3 italic text-muted-foreground">
                            <Inline text={trimmed.slice(2)}/>
                        </blockquote>
                    );
                }
                const bullet = trimmed.match(/^[-*]\s+(.*)$/);
                if (bullet) {
                    return (
                        <div key={index} className="flex gap-2 pl-1">
                            <span aria-hidden className="text-muted-foreground">•</span>
                            <span><Inline text={bullet[1]}/></span>
                        </div>
                    );
                }
                const numbered = trimmed.match(/^\d+\.\s+(.*)$/);
                if (numbered) {
                    const number = trimmed.match(/^(\d+)\./)![1];
                    return (
                        <div key={index} className="flex gap-2 pl-1">
                            <span className="tabular-nums text-muted-foreground">{number}.</span>
                            <span><Inline text={numbered[1]}/></span>
                        </div>
                    );
                }
                return <p key={index}><Inline text={trimmed}/></p>;
            })}
        </div>
    );
}

function Heading({level, text}: { level: 1 | 2 | 3 | 4; text: string }) {
    const className = {
        1: "text-lg font-semibold",
        2: "text-base font-semibold mt-1",
        3: "text-sm font-semibold uppercase tracking-wide text-muted-foreground",
        4: "text-sm font-semibold",
    }[level];
    return <p className={className}><Inline text={text}/></p>;
}

/** Renders a line with `**bold**` and `` `code` `` spans. */
function Inline({text}: { text: string }) {
    const parts: React.ReactNode[] = [];
    const pattern = /\*\*(.+?)\*\*|`([^`]+)`/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    while ((match = pattern.exec(text)) !== null) {
        if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
        if (match[1] !== undefined) {
            parts.push(<strong key={key++}>{match[1]}</strong>);
        } else {
            parts.push(
                <code key={key++} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
                    {match[2]}
                </code>
            );
        }
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return <>{parts}</>;
}
