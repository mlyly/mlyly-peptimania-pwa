import type {Metadata} from "next";
import {Suspense} from "react";

import {HomeLink} from "@/components/app/home-link";
import {HomeNav} from "@/components/app/home-nav";
import {NotificationCentre} from "@/components/notifications/notification-centre";
import {Card, CardContent, CardHeader} from "@/components/ui/card";
import {Skeleton} from "@/components/ui/skeleton";

export const metadata: Metadata = {
    title: "Reminders",
    description:
        "Due and upcoming doses with one-tap logging, 15-minute snooze and per-occurrence skip. Local-only; background delivery is optional.",
};

function CentreSkeleton() {
    return (
        <Card aria-busy="true">
            <CardHeader className="gap-2">
                <Skeleton className="h-5 w-40"/>
                <Skeleton className="h-3 w-64"/>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                <Skeleton className="h-16 w-full rounded-lg"/>
                <Skeleton className="h-16 w-full rounded-lg"/>
            </CardContent>
        </Card>
    );
}

export default function NotificationsPage() {
    return (
        <div className="flex flex-1 flex-col items-center gap-8 px-4 pb-12">
            <header className="flex w-full max-w-3xl flex-col gap-3">
                <div className="flex items-center gap-1">
                    <HomeLink/>
                    <h1 className="shrink-0 text-2xl font-semibold tracking-tight">Reminders</h1>
                    <HomeNav/>
                </div>
                <p className="text-muted-foreground max-w-2xl">
                    Review what is due, log a dose, snooze it for 15 minutes or skip this
                    occurrence. Actions update the local schedule and the optional relay
                    horizon — no dose content is sent to the relay in generic mode.
                </p>
            </header>

            <main className="flex w-full max-w-3xl flex-col gap-4">
                <Suspense fallback={<CentreSkeleton/>}>
                    <NotificationCentre/>
                </Suspense>
            </main>
        </div>
    );
}
