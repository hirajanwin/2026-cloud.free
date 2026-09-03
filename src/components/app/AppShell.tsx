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
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode, useRef } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {Layers, Moon, PanelRight, Plus, Receipt, Sparkles, Sun, SunMoon } from "lucide-react";
import { useThemeContext } from "@/lib/theme-context";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
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
import type { Provider } from "@/engine/dsl";
import { SERVICES, VENDOR_IDS, type VendorId } from "@/engine/services";

const PROVIDER_LABEL: Record<Provider, string> = { cloudflare: "Cloudflare", vercel: "Vercel" };
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
  const rightW = useRightWidth();
  return (
    <SidebarProvider peek="hover" shortcut="]" width={`${rightW}px`} className="h-svh overflow-hidden">
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

/** A horizontal strip you can drag (or wheel) to reveal what does not fit. */
function DragScroll({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  return (
    <div
      ref={ref}
      className={`scrollbar-hide overflow-x-auto cursor-grab active:cursor-grabbing ${className}`}
      onPointerDown={(e) => {
        const el = ref.current;
        if (!el) return;
        drag.current = { x: e.clientX, left: el.scrollLeft, moved: false };
      }}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el || !drag.current) return;
        const dx = e.clientX - drag.current.x;
        if (Math.abs(dx) > 4) drag.current.moved = true;
        if (drag.current.moved) {
          el.scrollLeft = drag.current.left - dx;
          el.setPointerCapture(e.pointerId);
        }
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onClickCapture={(e) => {
        // A drag must not count as a tab click.
        if (drag.current?.moved) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      onWheel={(e) => {
        const el = ref.current;
        if (el && Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
      }}
    >
      {children}
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

const RIGHT_KEY = "freenet.right.w";
const RIGHT_MIN = 300;
const RIGHT_DEFAULT = 384;
let setRightWidth: (w: number) => void = () => {};

/** Width of the right rail, remembered per browser. */
function useRightWidth(): number {
  const [w, setW] = useState(RIGHT_DEFAULT);
  useEffect(() => {
    try {
      const v = Number(window.localStorage.getItem(RIGHT_KEY));
      if (v >= RIGHT_MIN) setW(v);
    } catch {
      /* no storage */
    }
    setRightWidth = (next: number) => {
      const clamped = Math.max(RIGHT_MIN, Math.min(Math.round(window.innerWidth * 0.6), Math.round(next)));
      setW(clamped);
      try {
        window.localStorage.setItem(RIGHT_KEY, String(clamped));
      } catch {
        /* no storage */
      }
    };
  }, []);
  return w;
}

/** Thin grab strip on the right rail's inner edge. */
function RightResizeHandle() {
  const drag = useRef<{ startX: number; startW: number } | null>(null);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      title="Drag to resize"
      onPointerDown={(e) => {
        const el = e.currentTarget.closest("[data-slot=sidebar]") as HTMLElement | null;
        drag.current = { startX: e.clientX, startW: el?.getBoundingClientRect().width ?? RIGHT_DEFAULT };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        setRightWidth(drag.current.startW + (drag.current.startX - e.clientX));
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => setRightWidth(RIGHT_DEFAULT)}
      className="group absolute inset-y-0 left-0 z-20 w-2 cursor-col-resize touch-none"
    >
      <span className="absolute left-0.5 top-1/2 h-10 w-1 -translate-y-1/2 rounded-full bg-transparent transition-colors group-hover:bg-muted-foreground" />
    </div>
  );
}

function RightRail() {
  const panel = useStudio((s) => s.panel);
  const chatTab = useStudio((s) => s.chatTab);
  const unseen = useUnseenAgentActivity(panel);
  return (
    <Sidebar side="right" variant="inset" rail className="relative">
      <RightResizeHandle />
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
 * Left sidebar: freenets (saved designs), templates, products
 * ------------------------------------------------------------------ */

function AppSidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const templateId = useStudio((s) => s.templateId);
  const blueprintId = useStudio((s) => s.blueprintId);
  const provider = useStudio((s) => s.provider);
  const saved = useBlueprints();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const match = (...parts: (string | undefined)[]) => !q || parts.some((p) => p?.toLowerCase().includes(q));

  const goStudio = () => {
    if (pathname !== "/") void navigate({ to: "/" });
  };

  const [providerFilter, setProviderFilter] = useState<"all" | Provider | VendorId>("all");
  const [tab, setTab] = useState<"net" | "node">("net");
  /** Opening a net moves you to Node so the next click adds to it. */
  const openNet = () => {
    setTab("node");
    goStudio();
  };

  const addService = (service: string, label: string) => {
    const s = studio.get();
    const base = service.split(".")[1] ?? "service";
    let nid = base;
    let i = 2;
    while (s.diagram.nodes.some((n) => n.id === nid) || s.diagram.groups.some((g) => g.id === nid)) nid = `${base}-${i++}`;
    const { diagram } = applyPatch(s.diagram, [{ op: "add_node", id: nid, kind: "external", label, attrs: { service } }]);
    studio.setDiagram(diagram);
    studio.select(nid);
    studio.setPanel("inspect");
    goStudio();
  };

  const addNode = (kind: ProductKind, from: Provider = provider) => {
    if (from !== provider) studio.setProvider(from);
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

  const starters = TEMPLATES.filter((t) => !t.verdict && match(t.name, t.tagline));
  const mine = saved.filter((b) => match(b.name));
  // Products from every provider, grouped "Provider · Category"; the filter
  // narrows to one provider. Adding a product from the other provider switches
  // the canvas to it, since a design prices against one provider at a time.
  const productSections = useMemo(() => {
    const isVendor = (VENDOR_IDS as readonly string[]).includes(providerFilter);
    const providers: Provider[] = providerFilter === "all" ? ["cloudflare", "vercel"] : isVendor ? [] : [providerFilter as Provider];
    const out: { key: string; label: string; provider: Provider; kinds: ProductKind[]; services?: { service: string; name: string; tagline: string }[] }[] = [];
    for (const pv of providers) {
      const byCat: Record<string, ProductKind[]> = {};
      for (const k of PRODUCT_KINDS) {
        if (k === "client" || k === "external") continue;
        const p = PRODUCTS[pv][k];
        if (p.gap?.severity === "missing") continue;
        if (!match(p.name, KINDS[k].name, p.tagline, k, pv)) continue;
        (byCat[KINDS[k].category] ??= []).push(k);
      }
      for (const c of CATEGORY_ORDER) {
        if (!byCat[c]?.length) continue;
        out.push({ key: `${pv}:${c}`, label: `${PROVIDER_LABEL[pv]} · ${CATEGORY_LABEL[c]}`, provider: pv, kinds: byCat[c] });
      }
    }
    const vendors: VendorId[] = providerFilter === "all" ? [...VENDOR_IDS] : isVendor ? [providerFilter as VendorId] : [];
    for (const v of vendors) {
      const items = SERVICES[v].products
        .filter((p) => match(p.name, p.tagline, SERVICES[v].name, p.category))
        .map((p) => ({ service: `${v}.${p.id}`, name: p.name, tagline: p.tagline }));
      if (items.length) out.push({ key: `svc:${v}`, label: SERVICES[v].name, provider: "cloudflare", kinds: [], services: items });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providerFilter, q]);

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <SidebarWorkspaceHeader name="freenet.free" tile={<WorkspaceTile>F</WorkspaceTile>} />
          </div>
          <ThemeButton />
        </div>
        {/* Net: the designs. Node: what you add to them. Opening a net jumps to Node. */}
        <Tabs value={tab} onValueChange={(v) => setTab(v as "net" | "node")} size="compact" aria-label="Sidebar section">
          <TabsList className="w-full">
            <TabItem value="net" label="Net" className="flex-1 justify-center" />
            <TabItem value="node" label="Node" className="flex-1 justify-center" />
          </TabsList>
        </Tabs>
        <div className="flex flex-col gap-0.5">
          <SidebarSearchField placeholder={tab === "net" ? "Search freenets…" : "Search products…"} shortcut="/" value={query} onChange={(e) => setQuery(e.target.value)} />
          {tab === "node" && (
            <DragScroll className="-mx-1 px-1">
              <Tabs value={providerFilter} onValueChange={(v) => setProviderFilter(v as "all" | Provider | VendorId)} size="compact" aria-label="Provider filter">
                <TabsList>
                  <TabItem value="all" label="All" />
                  <TabItem value="cloudflare" label="Cloudflare" />
                  <TabItem value="vercel" label="Vercel" />
                  <TabItem value="openai" label="OpenAI" />
                  <TabItem value="shopify" label="Shopify" />
                  <TabItem value="netlify" label="Netlify" />
                </TabsList>
              </Tabs>
            </DragScroll>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {tab === "net" && (mine.length > 0 || !q) && (
          <SidebarGroup>
            <SidebarGroupLabel>Freenets</SidebarGroupLabel>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  icon={Plus}
                  onClick={() => {
                    blueprints.create();
                    studio.setPanel("inspect");
                    openNet();
                  }}
                >
                  New freenet
                </SidebarMenuButton>
              </SidebarMenuItem>
              {mine.map((b) => (
                <SidebarMenuItem key={b.id}>
                  <SidebarMenuButton
                    icon={Layers}
                    isActive={blueprintId === b.id && pathname === "/"}
                    onClick={() => {
                      blueprints.open(b.id);
                      openNet();
                    }}
                  >
                    <span className="truncate">{b.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {tab === "net" && starters.length > 0 && (
          <SidebarGroup>
            <SidebarMenu>
              {starters.map((t) => (
                <SidebarMenuItem key={t.id}>
                  <SidebarMenuButton
                    isActive={templateId === t.id && pathname === "/"}
                    onClick={() => {
                      studio.loadTemplate(t.id);
                      studio.setPanel("inspect");
                      openNet();
                    }}
                  >
                    <span className="truncate">{t.name}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}

        {tab === "node" && productSections.map((sec) => (
          <SidebarGroup key={sec.key}>
            <SidebarGroupLabel>{sec.label}</SidebarGroupLabel>
            <SidebarMenu>
              {sec.services?.map((sv) => (
                <SidebarMenuItem key={sv.service}>
                  <Tooltip content={sv.tagline} side="right">
                    <SidebarMenuButton onClick={() => addService(sv.service, sv.name)} className="group/add">
                      <span className="flex size-4 items-center justify-center text-muted-foreground">
                        <Glyph kind="external" size={15} />
                      </span>
                      <span className="truncate">{sv.name}</span>
                      <Plus className="ml-auto size-3.5 opacity-0 transition-opacity group-hover/add:opacity-100" />
                    </SidebarMenuButton>
                  </Tooltip>
                </SidebarMenuItem>
              ))}
              {sec.kinds.map((k) => {
                const p = PRODUCTS[sec.provider][k];
                return (
                  <SidebarMenuItem key={k}>
                    <Tooltip content={p.tagline} side="right">
                      <SidebarMenuButton onClick={() => addNode(k, sec.provider)} className="group/add">
                        <span className="flex size-4 items-center justify-center text-muted-foreground">
                          <Glyph kind={k} size={15} provider={sec.provider} />
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
        {q && (tab === "net" ? mine.length + starters.length : productSections.length) === 0 && (
          <div className="px-3 py-2 text-caption text-muted-foreground">Nothing matches “{query}”.</div>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
