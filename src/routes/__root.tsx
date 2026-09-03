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

const SITE_TITLE = "Blueprint";
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
    ],
    links: [{ rel: "stylesheet", href: appCss }],
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
