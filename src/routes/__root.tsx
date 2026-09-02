import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ThemeProvider } from "@/lib/theme-context";
import { SizeProvider } from "@/lib/size-context";
import { ShapeProvider } from "@/lib/shape-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/app/AppShell";
import { WebMcpBridge } from "@/components/app/WebMcpBridge";
import { ClockStarter } from "@/components/app/ClockStarter";
import appCss from "../styles.css?url";

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
