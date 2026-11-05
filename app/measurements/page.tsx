import type {Metadata} from "next";

import {HomeLink} from "@/components/app/home-link";
import {HomeNav} from "@/components/app/home-nav";
import {MeasurementsManager} from "@/components/measurements/measurements-manager";

export const metadata: Metadata = {
    title: "Body Metrics",
    description:
        "Track weight, blood pressure and any custom measurement — trend charts, history logs and quick add/delete, all stored locally.",
};

export default function MeasurementsPage() {
    return (
        <div className="flex flex-1 flex-col items-center gap-8 px-4 pb-12">
            <header className="flex w-full max-w-3xl flex-col gap-3">
                <div className="flex items-center gap-1">
                    <HomeLink/>
                    <h1 className="shrink-0 text-2xl font-semibold tracking-tight">Body Metrics</h1>
                    <HomeNav/>
                </div>
                <p className="text-muted-foreground max-w-2xl">
                    Weight and blood pressure come built in; add any tracker you
                    measure — body fat %, waist, glucose, heart rate — with your own
                    units. Every tracker gets a trend chart and a day-grouped history
                    you can extend or prune on the fly. Everything stays in this
                    browser.
                </p>
            </header>

            <main className="flex w-full max-w-3xl flex-col gap-4">
                <MeasurementsManager/>
            </main>
        </div>
    );
}
