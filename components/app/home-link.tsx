import Link from "next/link";
import {Home} from "lucide-react";

import {Button} from "@/components/ui/button";

/**
 * "Home" navigation for sub-pages, placed inline before the page title.
 * Icon-only house button linking to the dashboard.
 */
export function HomeLink() {
    return (
        <Button asChild variant="ghost" size="sm" aria-label="Home" className="-ml-2">
            <Link href="/">
                <Home className="size-5" aria-hidden/>
            </Link>
        </Button>
    );
}
