import type {Metadata} from "next";

import {HomeLink} from "@/components/app/home-link";
import {HomeNav} from "@/components/app/home-nav";
import {MedicationsManager} from "@/components/medications/medications-manager";

export const metadata: Metadata = {
    title: "Medications",
    description:
        "Manage medications, peptides and supplements — inventory, low-stock alerts, reconstitutions and schedule-linked dose volumes.",
};

export default function MedicationsPage() {
    return (
        <div className="flex flex-1 flex-col items-center gap-8 px-4 pb-12">
            <header className="flex w-full max-w-3xl flex-col gap-3">
                <div className="flex items-center gap-1">
                    <HomeLink/>
                    <h1 className="shrink-0 text-2xl font-semibold tracking-tight">Medications</h1>
                    <HomeNav/>
                </div>
                <p className="text-muted-foreground max-w-2xl">
                    Track what you stock, what you’re running low on, and exactly how
                    much to draw for each scheduled dose. Everything stays in this
                    browser.
                </p>
            </header>

            <main className="flex w-full max-w-3xl flex-col gap-4">
                <MedicationsManager/>
            </main>
        </div>
    );
}
