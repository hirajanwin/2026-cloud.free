/**
 * The application frame: Fluid Functionalism's inset sidebar on the left,
 * a topbar with the provider and plan switches, and the page in the inset.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  BookOpen,
  Layers,
  Moon,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sun,
  SunMoon,
  Wand2,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import { SidebarInsetTopbar } from "@/components/sidebar-app/inset-topbar";
import {
  SidebarWorkspaceHeader,
  WorkspaceTile,
} from "@/components/sidebar-app/workspace-header";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { useThemeContext } from "@/lib/theme-context";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  KINDS,
  PRODUCTS,
  PRODUCT_KINDS,
  type ProductKind,
} from "@/engine/catalog";
import { applyPatch } from "@/engine/dsl";
import { TEMPLATES } from "@/engine/templates";
import { studio, useStudio } from "@/state/store";
import { formatElapsed } from "@/lib/format";
import { Glyph, ProviderDot } from "./Glyph";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider peek="hover" defaultOpen>
      <AppSidebar />
      <SidebarInset className="flex min-h-svh flex-col">
        <SidebarInsetTopbar className="border-b border-border pr-3">
          <Topbar />
        </SidebarInsetTopbar>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/* ------------------------------------------------------------------ */

function AppSidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const templateId = useStudio((s) => s.templateId);
  const provider = useStudio((s) => s.provider);
  const nodeCount = useStudio((s) => s.diagram.nodes.length);
  const [showAllProducts, setShowAllProducts] = useState(false);

  const verdicts = TEMPLATES.filter((t) => t.verdict);
  const starters = TEMPLATES.filter((t) => !t.verdict);

  const addNode = (kind: ProductKind) => {
    const s = studio.get();
    let id = kind;
    let i = 2;
    while (
      s.diagram.nodes.some((n) => n.id === id) ||
      s.diagram.groups.some((g) => g.id === id)
    )
      id = `${kind}-${i++}` as ProductKind;
    const { diagram } = applyPatch(s.diagram, [
      { op: "add_node", id, kind, label: PRODUCTS[s.provider][kind].name },
    ]);
    studio.setDiagram(diagram);
    studio.select(id);
    if (pathname !== "/") void navigate({ to: "/" });
  };

  const kindsByCategory = useMemo(() => {
    const out: Record<string, ProductKind[]> = {};
    for (const k of PRODUCT_KINDS) {
      if (k === "client" && !showAllProducts) continue;
      (out[KINDS[k].category] ??= []).push(k);
    }
    return out;
  }, [showAllProducts]);

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SidebarWorkspaceHeader
          name="Blueprint"
          tile={<WorkspaceTile>B</WorkspaceTile>}
        />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              icon={Layers}
              isActive={pathname === "/"}
              asChild
            >
              <Link to="/">
                Studio
                <SidebarMenuBadge>{nodeCount}</SidebarMenuBadge>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Verdicts</SidebarGroupLabel>
          <SidebarMenu>
            {verdicts.map((t) => (
              <SidebarMenuItem key={t.id}>
                <SidebarMenuButton
                  icon={BookOpen}
                  isActive={pathname === `/verdict/${t.id}`}
                  asChild
                >
                  <Link to="/verdict/$slug" params={{ slug: t.id }}>
                    {t.verdict!.product}
                    <SidebarMenuBadge>
                      {t.verdict!.call === "yes"
                        ? "yes"
                        : t.verdict!.call === "kinda"
                          ? "kinda"
                          : "no"}
                    </SidebarMenuBadge>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Templates</SidebarGroupLabel>
          <SidebarMenu>
            {starters.map((t) => (
              <SidebarMenuItem key={t.id}>
                <SidebarMenuButton
                  icon={Wand2}
                  isActive={templateId === t.id && pathname === "/"}
                  onClick={() => {
                    studio.loadTemplate(t.id);
                    if (pathname !== "/") void navigate({ to: "/" });
                  }}
                >
                  {t.name}
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>

        {CATEGORY_ORDER.filter((c) => kindsByCategory[c]?.length).map((c) => (
          <SidebarGroup key={c}>
            <SidebarGroupLabel>
              <span className="inline-flex items-center gap-1.5">
                <ProviderDot provider={provider} /> {CATEGORY_LABEL[c]}
              </span>
            </SidebarGroupLabel>
            <SidebarMenu>
              {kindsByCategory[c].map((k) => {
                const p = PRODUCTS[provider][k];
                return (
                  <SidebarMenuItem key={k}>
                    <Tooltip content={p.tagline} side="right">
                      <SidebarMenuButton
                        onClick={() => addNode(k)}
                        className="group/add"
                      >
                        <span className="flex size-4 items-center justify-center text-muted-foreground">
                          <Glyph kind={k} size={15} />
                        </span>
                        <span className="truncate">{p.name}</span>
                        <Plus className="ml-auto size-3.5 opacity-0 transition-opacity group-hover/add:opacity-100" />
                      </SidebarMenuButton>
                    </Tooltip>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        ))}
        <div className="px-2 pb-2">
          <Button
            variant="ghost"
            size="compact"
            onClick={() => setShowAllProducts((v) => !v)}
          >
            {showAllProducts ? "Hide traffic source" : "Show every kind"}
          </Button>
        </div>
      </SidebarContent>

      <SidebarFooter>
        <div className="px-2 py-1 text-caption text-muted-foreground">
          Click a product to add it. Word marks belong to their owners; this
          tool is independent.
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}

/* ------------------------------------------------------------------ */

function Topbar() {
  const provider = useStudio((s) => s.provider);
  const plan = useStudio((s) => s.plan);
  const title = useStudio((s) => s.diagram.title);
  const running = useStudio((s) => s.running);
  const elapsed = useStudio((s) => s.snapshot.elapsedS);
  const webmcp = useStudio((s) => s.webmcp);
  const { theme, setTheme } = useThemeContext();

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="min-w-0 truncate text-subtitle font-medium">
        {title ?? "Untitled"}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Tabs
          value={provider}
          onValueChange={(v) => studio.setProvider(v as typeof provider)}
          size="compact"
          aria-label="Provider"
        >
          <TabsList>
            <TabItem value="cloudflare" label="Cloudflare" />
            <TabItem value="vercel" label="Vercel" />
          </TabsList>
        </Tabs>
        <Tabs
          value={plan}
          onValueChange={(v) => studio.setPlan(v as typeof plan)}
          size="compact"
          aria-label="Plan"
        >
          <TabsList>
            <TabItem
              value="free"
              label={provider === "cloudflare" ? "Free" : "Hobby"}
            />
            <TabItem
              value="paid"
              label={provider === "cloudflare" ? "Workers Paid" : "Pro"}
            />
          </TabsList>
        </Tabs>

        <span className="hidden items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-caption text-numeric text-muted-foreground shadow-surface-1 md:inline-flex">
          <Activity className="size-3.5" /> {formatElapsed(elapsed)}
        </span>
        <Tooltip content={running ? "Pause the clock" : "Resume the clock"}>
          <Button
            variant="tertiary"
            size="compact"
            aria-label={running ? "Pause" : "Play"}
            onClick={() => studio.setRunning(!running)}
          >
            {running ? (
              <Pause className="size-3.5" />
            ) : (
              <Play className="size-3.5" />
            )}
          </Button>
        </Tooltip>
        <Tooltip content="Reset the clock">
          <Button
            variant="tertiary"
            size="compact"
            aria-label="Reset clock"
            onClick={() => studio.resetClock()}
          >
            <RotateCcw className="size-3.5" />
          </Button>
        </Tooltip>

        <Tooltip
          content={
            webmcp.supported
              ? `${webmcp.registered} tools registered on document.modelContext. Ask the browser's agent to drive the canvas.`
              : "No WebMCP in this browser. Enable chrome://flags/#enable-webmcp-testing in Chrome 149+. The in-page assistant still works; its tools run directly."
          }
        >
          <span>
            <Badge
              color={webmcp.supported ? "green" : "gray"}
              variant="dot"
              size="compact"
            >
              WebMCP {webmcp.supported ? `· ${webmcp.registered} tools` : "off"}
            </Badge>
          </span>
        </Tooltip>

        <Tooltip content={`Theme: ${theme}. Press T to cycle.`}>
          <Button
            variant="ghost"
            size="compact"
            aria-label="Cycle theme"
            onClick={() =>
              setTheme(
                theme === "system"
                  ? "light"
                  : theme === "light"
                    ? "dark"
                    : "system",
              )
            }
          >
            {theme === "system" ? (
              <SunMoon className="size-3.5" />
            ) : theme === "light" ? (
              <Sun className="size-3.5" />
            ) : (
              <Moon className="size-3.5" />
            )}
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
