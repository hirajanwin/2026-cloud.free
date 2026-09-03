/**
 * The application frame: two Fluid Functionalism inset sidebars on one
 * plane. Left holds blueprints, templates and the product palette; right
 * holds the studio panels. The main card between them carries the top bar
 * with the live traffic strip, the canvas, and the timeline.
 *
 * Each sidebar needs its own provider, so the right provider wraps the left
 * one; a small context bridge lets the top bar (inside the left tree) toggle
 * the right rail.
 */
import { createContext, useContext, useMemo, useState, type ReactNode, useRef } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {BookOpen, Layers, Moon, PanelRight, Plus, Receipt, Save, Sparkles, Sun, SunMoon } from "lucide-react";
import { useThemeContext } from "@/lib/theme-context";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar";
import { SidebarSearchField } from "@/components/sidebar-app/search-field";
import { SidebarWorkspaceHeader, WorkspaceTile } from "@/components/sidebar-app/workspace-header";
import { Tabs, TabItem, TabsList } from "@/components/ui/tabs";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { CATEGORY_LABEL, CATEGORY_ORDER, KINDS, PRODUCTS, PRODUCT_KINDS, type ProductKind } from "@/engine/catalog";
import { applyPatch } from "@/engine/dsl";
import { TEMPLATES } from "@/engine/templates";
import { studio, useStudio, type PanelId } from "@/state/store";
import { blueprints, useBlueprints } from "@/state/blueprints";
import { Glyph } from "./Glyph";
import { Topbar, TrafficStrip } from "./Topbar";
import { Inspector } from "./Inspector";
import { BillPanel } from "./BillPanel";
import { Chat } from "./Chat";
import { useToolLog } from "@/state/toollog";
import { DslEditor } from "./DslEditor";
import { ActivityPanel } from "./ActivityPanel";
import { AlternativesPanel } from "./AlternativesPanel";
import { ClientOnly } from "@tanstack/react-router";

/* ------------------------------------------------------------------ *
 * Right sidebar bridge
 * ------------------------------------------------------------------ */

interface RightSidebar {
  open: boolean;
  toggle: () => void;
  setOpen: (v: boolean) => void;
}
const RightSidebarCtx = createContext<RightSidebar | null>(null);

function RightSidebarBridge({ children }: { children: ReactNode }) {
  const { open, toggleSidebar, setOpen } = useSidebar();
  const value = useMemo(() => ({ open, toggle: toggleSidebar, setOpen }), [open, toggleSidebar, setOpen]);
  return <RightSidebarCtx.Provider value={value}>{children}</RightSidebarCtx.Provider>;
}

export function useRightSidebar(): RightSidebar | null {
  return useContext(RightSidebarCtx);
}

function RightTrigger() {
  const right = useRightSidebar();
  if (!right) return null;
  return (
    <Tooltip content={`${right.open ? "Hide" : "Show"} panels  ]`}>
      <Button variant="ghost" size="compact" aria-label="Toggle panels" onClick={right.toggle}>
        <PanelRight className="size-4" />
      </Button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ */

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const isStudio = pathname === "/";
  return (
    <SidebarProvider peek="hover" shortcut="]" width="24rem" className="h-svh overflow-hidden">
      <RightSidebarBridge>
        <SidebarProvider peek="hover" className="h-svh min-w-0 flex-1 overflow-hidden">
          <AppSidebar />
          <SidebarInset className={`flex min-h-0 flex-col overflow-hidden bg-surface-2 shadow-surface-2 ${isStudio ? "!mr-0" : ""}`}>
            <Topbar rightTrigger={isStudio ? <RightTrigger /> : null} />
            {isStudio && <TrafficStrip />}
            <div className={`flex min-h-0 flex-1 flex-col ${isStudio ? "" : "overflow-y-auto"}`}>{children}</div>
          </SidebarInset>
        </SidebarProvider>
        {isStudio && <RightRail />}
      </RightSidebarBridge>
    </SidebarProvider>
  );
}

/* ------------------------------------------------------------------ *
 * Right rail: the studio panels
 * ------------------------------------------------------------------ */

const PANELS: { value: PanelId; label: string; icon: typeof Layers }[] = [
  { value: "inspect", label: "Inspect", icon: Layers },
  { value: "bill", label: "Bill", icon: Receipt },
  { value: "chat", label: "AI", icon: Sparkles },
];

function ChatTabs() {
  const chatTab = useStudio((s) => s.chatTab);
  const tabs = [
    { value: "chat", label: "Chat" },
    { value: "code", label: "DSL" },
    { value: "activity", label: "Tools" },
    { value: "alternatives", label: "Alternatives" },
  ] as const;
  const idx = tabs.findIndex((t) => t.value === chatTab);
  return (
    <div className="mb-2">
      <TabsSubtle selectedIndex={idx} onSelect={(i) => studio.setChatTab(tabs[i].value)} size="compact" className="w-full">
        {tabs.map((t, i) => (
          <TabsSubtleItem key={t.value} index={i} label={t.label} className="flex-1 justify-center" />
        ))}
      </TabsSubtle>
    </div>
  );
}

/** Browser-agent tool calls that arrived while the AI panel was not showing. */
function useUnseenAgentActivity(panel: PanelId): number {
  const log = useToolLog();
  const agentCalls = log.filter((e) => e.caller === "browser-agent").length;
  const seen = useRef(agentCalls);
  if (panel === "chat") seen.current = agentCalls;
  return Math.max(0, agentCalls - seen.current);
}

function RightRail() {
  const panel = useStudio((s) => s.panel);
  const chatTab = useStudio((s) => s.chatTab);
  const unseen = useUnseenAgentActivity(panel);
  return (
    <Sidebar side="right" variant="inset" rail={false}>
      <SidebarHeader className="px-2 pt-2">
        <Tabs value={panel} onValueChange={(v) => studio.setPanel(v as PanelId)} size="compact">
          <TabsList className="w-full">
            {PANELS.map((p) => (
              <span key={p.value} className="relative flex flex-1">
                <TabItem value={p.value} label={p.label} className="flex-1 justify-center" />
                {p.value === "chat" && unseen > 0 && (
                  <span className="dot-pulse pointer-events-none absolute right-1.5 top-1 size-1.5 rounded-full bg-focus-ring" aria-label={`${unseen} new agent actions`} />
                )}
              </span>
            ))}
          </TabsList>
        </Tabs>
      </SidebarHeader>
      {panel !== "chat" && (
        <SidebarContent className="px-3 pb-3 pt-2">
          <div key={panel} className="panel-in min-w-0">
            {panel === "inspect" && <Inspector />}
            {panel === "bill" && <BillPanel />}
          </div>
        </SidebarContent>
      )}
      {/* Chat, DSL and Tools share one panel. Chat stays mounted so the conversation survives switching. */}
      <div hidden={panel !== "chat"} className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-1">
        <ChatTabs />
        <div hidden={chatTab !== "chat"} className="flex min-h-0 flex-1 flex-col">
          <ClientOnly fallback={null}>
            <Chat />
          </ClientOnly>
        </div>
        <div hidden={chatTab !== "code"} className="flex min-h-0 flex-1 flex-col">
          <DslEditor />
        </div>
        {chatTab === "activity" && (
          <div className="panel-in min-h-0 flex-1 overflow-y-auto">
            <ActivityPanel />
          </div>
        )}
        {chatTab === "alternatives" && (
          <div className="panel-in min-h-0 flex-1 overflow-y-auto">
            <AlternativesPanel />
          </div>
        )}
      </div>
    </Sidebar>
  );
}

function ThemeButton() {
  const { theme, setTheme } = useThemeContext();
  const Icon = theme === "system" ? SunMoon : theme === "light" ? Sun : Moon;
  return (
    <Tooltip content={`Theme: ${theme}. Press T to cycle.`} side="right">
      <Button
        variant="ghost"
        size="compact"
        aria-label="Cycle theme"
        onClick={() => setTheme(theme === "system" ? "light" : theme === "light" ? "dark" : "system")}
      >
        <Icon className="size-4" />
      </Button>
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ *
 * Left sidebar: blueprints, templates, verdicts, products
 * ------------------------------------------------------------------ */

function AppSidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const templateId = useStudio((s) => s.templateId);
  const blueprintId = useStudio((s) => s.blueprintId);
  const provider = useStudio((s) => s.provider);
  const nodeCount = useStudio((s) => s.diagram.nodes.length);
  const saved = useBlueprints();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const match = (...parts: (string | undefined)[]) => !q || parts.some((p) => p?.toLowerCase().includes(q));

  const goStudio = () => {
    if (pathname !== "/") void navigate({ to: "/" });
  };

  const addNode = (kind: ProductKind) => {
    const s = studio.get();
    let nid: string = kind;
    let i = 2;
    while (s.diagram.nodes.some((n) => n.id === nid) || s.diagram.groups.some((g) => g.id === nid)) nid = `${kind}-${i++}`;
    const { diagram } = applyPatch(s.diagram, [{ op: "add_node", id: nid, kind }]);
    studio.setDiagram(diagram);
    studio.select(nid);
    studio.setPanel("inspect");
    goStudio();
  };

  const verdicts = TEMPLATES.filter((t) => t.verdict && match(t.name, t.verdict.product, t.tagline));
  const starters = TEMPLATES.filter((t) => !t.verdict && match(t.name, t.tagline));
  const mine = saved.filter((b) => match(b.name));
  const kindsByCategory = useMemo(() => {
    const out: Record<string, ProductKind[]> = {};
    for (const k of PRODUCT_KINDS) {
      if (k === "client") continue;
      const p = PRODUCTS[provider][k];
      if (!match(p.name, KINDS[k].name, p.tagline, k)) continue;
      (out[KINDS[k].category] ??= []).push(k);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, q]);

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <SidebarWorkspaceHeader name="freenet.free" tile={<WorkspaceTile>F</WorkspaceTile>} />
          </div>
          <ThemeButton />
        </div>
        <div className="flex flex-col gap-0.5">
          <SidebarSearchField placeholder="Search blueprints, products…" shortcut="/" value={query} onChange={(e) => setQuery(e.target.value)} />
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                icon={Plus}
                onClick={() => {
                  blueprints.create();
                  studio.setPanel("inspect");
                  goStudio();
                }}
              >
                New blueprint
              </SidebarMenuButton>
            </SidebarMenuItem>
            {!blueprintId && pathname === "/" && (
              <SidebarMenuItem>
                <SidebarMenuButton icon={Save} onClick={() => blueprints.saveCurrent()}>
                  Save canvas as blueprint
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {(mine.length > 0 || !q) && (
          <SidebarGroup>
            <SidebarGroupLabel>Blueprints</SidebarGroupLabel>
            <SidebarMenu>
              {mine.length === 0 && <div className="px-2 py-1 text-caption text-muted-foreground">Nothing saved yet. Remix a template or save the canvas.</div>}
              {mine.map((b) => (
                <SidebarMenuItem key={b.id}>
                  <SidebarMenuButton
                    icon={Layers}
                    isActive={blueprintId === b.id && pathname === "/"}
                    onClick={() => {
                      blueprints.open(b.id);
                      goStudio();
                    }}
                  >
                    <span className="truncate">{b.name}</span>
                    {blueprintId === b.id && pathname === "/" && <SidebarMenuBadge>{nodeCount}</SidebarMenuBadge>}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {starters.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Templates</SidebarGroupLabel>
            <SidebarMenu>
              {starters.map((t) => (
                <SidebarMenuItem key={t.id}>
                  <SidebarMenuButton isActive={templateId === t.id && pathname === "/"}
                    onClick={() => {
                      studio.loadTemplate(t.id);
                      studio.setPanel("inspect");
                      goStudio();
                    }}
                  >
                    {t.name}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {verdicts.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Verdicts</SidebarGroupLabel>
            <SidebarMenu>
              {verdicts.map((t) => (
                <SidebarMenuItem key={t.id}>
                  <SidebarMenuButton icon={BookOpen} isActive={pathname === `/verdict/${t.id}`} asChild>
                    <Link to="/verdict/$slug" params={{ slug: t.id }}>
                      {t.verdict!.product}
                      <SidebarMenuBadge>{t.verdict!.call === "yes" ? "yes" : t.verdict!.call === "kinda" ? "kinda" : "no"}</SidebarMenuBadge>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {CATEGORY_ORDER.filter((c) => kindsByCategory[c]?.length).map((c) => (
          <SidebarGroup key={c}>
            <SidebarGroupLabel>
              {CATEGORY_LABEL[c]}
            </SidebarGroupLabel>
            <SidebarMenu>
              {kindsByCategory[c].map((k) => {
                const p = PRODUCTS[provider][k];
                return (
                  <SidebarMenuItem key={k}>
                    <Tooltip content={p.tagline} side="right">
                      <SidebarMenuButton onClick={() => addNode(k)} className="group/add">
                        <span className="flex size-4 items-center justify-center text-muted-foreground">
                          <Glyph kind={k} size={15} provider={provider} />
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
        {q && mine.length + starters.length + verdicts.length + Object.keys(kindsByCategory).length === 0 && (
          <div className="px-3 py-2 text-caption text-muted-foreground">Nothing matches “{query}”.</div>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
