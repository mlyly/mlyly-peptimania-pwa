import type {Metadata} from "next";

import {HomeLink} from "@/components/app/home-link";
import {HomeNav} from "@/components/app/home-nav";
import {StorageStatus} from "@/components/app/storage-status";
import {ChartSettings} from "@/components/settings/chart-settings";
import {DataManagement} from "@/components/settings/data-management";
import {NotificationSettings} from "@/components/settings/notification-settings";

export const metadata: Metadata = {
    title: "Settings",
    description:
        "Privacy and data management — export, import or wipe all locally stored data. Local-only by default; optional notifications are the only server-assisted feature.",
};

export default function SettingsPage() {
    return (
        <div className="flex flex-1 flex-col items-center gap-8 px-4 pb-12">
            <header className="flex w-full max-w-2xl flex-col gap-3">
                <div className="flex items-center gap-1">
                    <HomeLink/>
                    <h1 className="shrink-0 text-2xl font-semibold tracking-tight">Settings</h1>
                    <HomeNav/>
                </div>
                <p className="text-muted-foreground max-w-xl">
                    Your data lives only in this browser (IndexedDB) — export, import
                    or erase it. Nothing leaves your device unless you explicitly
                    enable the optional notification relay.
                </p>
            </header>

            <main className="flex w-full max-w-2xl flex-col gap-4">
                <StorageStatus/>
                <ChartSettings/>
                <NotificationSettings/>
                <DataManagement/>
            </main>
        </div>
    );
}
