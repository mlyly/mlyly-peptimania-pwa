import type {Metadata, Viewport} from "next";
import {Geist, Geist_Mono} from "next/font/google";
import "./globals.css";

import {LAST_COMMIT_HASH, LAST_MODIFIED, LAST_MODIFIED_TIME} from "@/lib/app-info";
import {OfflineFooterMarker} from "./offline-footer-marker";
import {OfflineBanner} from "@/components/app/offline-banner";
import {Toaster} from "@/components/ui/toaster";
import {TermsGate} from "@/components/legal/terms-gate";
import {ServiceWorkerRegister} from "@/components/pwa/service-worker-register";
import {MobileZoomLock} from "@/components/pwa/mobile-zoom-lock";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const APP_NAME = "Peptimania";
const APP_DESCRIPTION =
    "Privacy-first, offline-capable peptide & medication tracker. All data stays in your browser.";

export const metadata: Metadata = {
    title: {
        default: `${APP_NAME} — Peptide & Medication Tracker`,
        template: `%s — ${APP_NAME}`,
    },
    description: APP_DESCRIPTION,
    applicationName: APP_NAME,
    manifest: "/manifest.webmanifest",
    appleWebApp: {
        capable: true,
        statusBarStyle: "black-translucent",
        title: APP_NAME,
    },
    icons: {
        icon: "/icons/icon-192.png",
        apple: "/icons/apple-touch-icon.png",
    },
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    // App-like feel on phones/tablets: no pinch or double-tap zoom. Desktop
    // browsers ignore these values for page zoom, so desktop zoom still works.
    // Android Chrome ignores `user-scalable=no`, so `MobileZoomLock` adds a
    // touch guard; the CSS media query below covers the scroll/pinch surface.
    maximumScale: 1,
    userScalable: false,
    viewportFit: "cover",
    themeColor: [
        {media: "(prefers-color-scheme: light)", color: "#ffffff"},
        {media: "(prefers-color-scheme: dark)", color: "#0a0a0a"},
    ],
};

// Applies the dark class before first paint (no flash) and keeps it in sync
// when the OS theme changes. A manual toggle can replace the listeners later.
const themeInitScript = `
(function () {
  var root = document.documentElement;
  var mql = window.matchMedia("(prefers-color-scheme: dark)");
  function apply() {
    root.classList.toggle("dark", mql.matches);
    root.style.colorScheme = mql.matches ? "dark" : "light";
  }
  apply();
  mql.addEventListener("change", apply);
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
    <head>
        <script dangerouslySetInnerHTML={{__html: themeInitScript}}/>
    </head>
    <body className="min-h-full flex flex-col">
    <OfflineBanner/>
    {children}
    <TermsGate/>
    <Toaster/>
    <footer className="mt-auto border-t">
        <div
            className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 text-xs"
            style={{
                paddingTop: "0.75rem",
                paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))",
            }}
        >
            <OfflineFooterMarker/>
            {LAST_MODIFIED && (
                <p
                    className="text-muted-foreground whitespace-nowrap"
                    title={LAST_COMMIT_HASH ? `Commit ${LAST_COMMIT_HASH}` : undefined}
                >
                    Last updated {LAST_MODIFIED} {LAST_MODIFIED_TIME}
                </p>
            )}
        </div>
    </footer>
    <ServiceWorkerRegister/>
    <MobileZoomLock/>
    </body>
    </html>
  );
}
