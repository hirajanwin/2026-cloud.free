import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ThemeProvider } from "@/lib/theme-context";
import { SizeProvider } from "@/lib/size-context";
import { ShapeProvider } from "@/lib/shape-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/app/AppShell";
import { WebMcpBridge } from "@/components/app/WebMcpBridge";
import { DeclarativeTools } from "@/components/app/DeclarativeTools";
import { ClockStarter } from "@/components/app/ClockStarter";
import { ShortcutsHelp } from "@/components/app/ShortcutsHelp";
import appCss from "../styles.css?url";
import { tools } from "@/tools";
import { earlyRegistrationScript } from "@/tools/early";
import { ABOUT } from "@/tools/studio";

const WEBMCP_EARLY_SCRIPT = earlyRegistrationScript(tools);

/** Machine-readable description of the app for agents that read the page before using tools. */
const APP_JSON_LD = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: ABOUT.name,
  description: ABOUT.whatItIs,
  applicationCategory: "DeveloperApplication",
  featureList: ABOUT.howToThink,
  potentialAction: tools.map((t) => ({ "@type": "Action", name: t.name, description: t.description })),
}).replace(/</g, "\\u003c");

const THEME_INIT_SCRIPT = `(function(){try{var s=window.localStorage.getItem('theme');var r=document.documentElement;r.classList.remove('light','dark');if(s==='light'||s==='dark'){r.classList.add(s);}}catch(e){}})();`;

const SITE_TITLE = "freenet.free";
/** Public origin, used for absolute Open Graph URLs. Change when the domain does. */
const SITE_URL = "https://freenet.free";
const SITE_DESCRIPTION =
  "Design how to build a product on Cloudflare or Vercel, watch requests flow and get billed, and let your browser's agent drive the canvas through WebMCP.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_TITLE },
      { name: "description", content: SITE_DESCRIPTION },
      { property: "og:title", content: SITE_TITLE },
      { property: "og:description", content: SITE_DESCRIPTION },
      { name: "color-scheme", content: "light dark" },
      { name: "theme-color", content: "#101010" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: SITE_TITLE },
      { property: "og:url", content: SITE_URL },
      { property: "og:image", content: `${SITE_URL}/og.png` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      { property: "og:image:alt", content: "freenet.free: three nodes, one net" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: SITE_TITLE },
      { name: "twitter:description", content: SITE_DESCRIPTION },
      { name: "twitter:image", content: `${SITE_URL}/og.png` },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/icon-512.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: () => (
    <div className="p-6 text-body text-muted-foreground">Nothing here.</div>
  ),
});

function RootDocument({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: WEBMCP_EARLY_SCRIPT }} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: APP_JSON_LD }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased">
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <SizeProvider>
              <ShapeProvider defaultShape="rounded">
                <TooltipProvider>
                  <AppShell>{children}</AppShell>
                  <WebMcpBridge />
                  <DeclarativeTools />
                  <ClockStarter />
                  <ShortcutsHelp />
                </TooltipProvider>
              </ShapeProvider>
            </SizeProvider>
          </ThemeProvider>
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
