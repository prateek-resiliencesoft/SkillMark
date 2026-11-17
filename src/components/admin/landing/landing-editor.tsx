"use client";

import { FieldForm } from "@/components/admin/landing/field-form";
import { MediaLibrary } from "@/components/admin/landing/media-picker";
import { PageHeader, Panel, TacticalButton } from "@/components/admin/admin-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SortableList } from "@/components/ui/sortable-list";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { BLOCKS, BLOCK_MAP } from "@landing/shared/blocks";
import { presetSection } from "@landing/shared/defaults";
import { newId } from "@landing/shared/ids";
import { CUSTOM_SECTION, PRESETS, PRESET_MAP } from "@landing/shared/presets";
import {
  FOOTER_FIELDS,
  NAV_FIELDS,
  PAGE_SEO_FIELDS,
  SETTINGS_FIELDS,
  type Block,
  type Page,
  type Section,
  type SiteDocument,
} from "@landing/shared/schema";
import { STYLE_FIELDS } from "@landing/shared/style";
import { postToFrame } from "@landing/shared/preview";
import Editor from "@monaco-editor/react";
import {
  Copy,
  Eye,
  EyeOff,
  History,
  Laptop,
  Loader2,
  Monitor,
  Plus,
  Redo2,
  Smartphone,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const LANDING_URL =
  (process.env.NEXT_PUBLIC_LANDING_URL || "https://resiliencesoftinterview.com").replace(/\/$/, "");

type Device = "desktop" | "tablet" | "mobile";
type Mode = "simple" | "advanced";

function deepClone<T>(v: T): T {
  return structuredClone(v);
}

export function LandingEditor() {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const draftQuery = trpc.landing.getDraft.useQuery(undefined, { staleTime: 5_000 });

  const [doc, setDoc] = useState<SiteDocument | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Bumps on every local edit; only the matching revision may clear dirty after save. */
  const revisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const [pageId, setPageId] = useState("home");
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("simple");
  const [device, setDevice] = useState<Device>("desktop");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [tab, setTab] = useState("editor");
  const [publishNote, setPublishNote] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveMut = trpc.landing.saveDraft.useMutation();
  const discardMut = trpc.landing.discardDraft.useMutation();
  const publishMut = trpc.landing.publish.useMutation();
  const restoreMut = trpc.landing.restoreVersion.useMutation();
  const previewToken = trpc.landing.createPreviewToken.useMutation();
  const versions = trpc.landing.listVersions.useQuery(undefined, { enabled: tab === "versions" });
  const rebuild = trpc.landing.rebuildStatus.useQuery(undefined, {
    refetchInterval: (data) =>
      ["queued", "in_progress", "requested"].includes(data?.status ?? "") ? 5000 : false,
  });

  useEffect(() => {
    if (!draftQuery.data || doc) return;
    setDoc(deepClone(draftQuery.data.content));
    const home = draftQuery.data.content.pages.find((p) => p.slug === "") ?? draftQuery.data.content.pages[0];
    if (home) {
      setPageId(home.id);
      setSectionId(home.sections[0]?.id ?? null);
    }
  }, [draftQuery.data, doc]);

  const page = doc?.pages.find((p) => p.id === pageId) ?? null;
  const section = page?.sections.find((s) => s.id === sectionId) ?? null;

  const updateDoc = useCallback((updater: (d: SiteDocument) => SiteDocument) => {
    setDoc((prev) => {
      if (!prev) return prev;
      revisionRef.current += 1;
      setDirty(true);
      return updater(deepClone(prev));
    });
  }, []);

  // Autosave — only clear dirty when the response matches the revision that was sent.
  useEffect(() => {
    if (!doc || !dirty) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const revisionAtSchedule = revisionRef.current;
    const snapshot = doc;
    saveTimer.current = setTimeout(() => {
      // Another edit landed while we waited — let the next effect run handle it.
      if (revisionRef.current !== revisionAtSchedule) return;
      setSaving(true);
      const revisionAtSend = revisionRef.current;
      saveMut.mutate(
        { content: snapshot },
        {
          onSuccess: () => {
            savedRevisionRef.current = revisionAtSend;
            // Only clear dirty if nothing newer has been typed since this request left.
            if (revisionRef.current === revisionAtSend) setDirty(false);
            setSaving(false);
            utils.landing.getDraft.invalidate();
          },
          onError: (err) => {
            setSaving(false);
            toast({ title: "Could not save draft", description: err.message, variant: "destructive" });
          },
        },
      );
    }, 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [doc, dirty]); // eslint-disable-line react-hooks/exhaustive-deps

  // Push draft to iframe
  useEffect(() => {
    if (!doc) return;
    postToFrame(
      iframeRef.current,
      { type: "lp:document", document: doc, pageSlug: page?.slug },
      LANDING_URL,
    );
  }, [doc, page?.slug]);

  useEffect(() => {
    postToFrame(iframeRef.current, { type: "lp:theme", theme }, LANDING_URL);
  }, [theme]);

  useEffect(() => {
    postToFrame(iframeRef.current, { type: "lp:highlight", sectionId }, LANDING_URL);
  }, [sectionId]);

  // Listen for section clicks from preview
  useEffect(() => {
    function onMsg(ev: MessageEvent) {
      if (ev.origin !== LANDING_URL) return;
      const data = ev.data as { source?: string; type?: string; sectionId?: string; pageId?: string };
      if (data?.source !== "skillmark-landing-preview") return;
      if (data.type === "lp:select" && data.sectionId) {
        if (data.pageId) setPageId(data.pageId);
        setSectionId(data.sectionId);
      }
      if (data.type === "lp:ready" && doc) {
        postToFrame(
          iframeRef.current,
          { type: "lp:document", document: doc, pageSlug: page?.slug },
          LANDING_URL,
        );
      }
    }
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [doc, page?.slug]);

  const previewSrc = useMemo(() => {
    const slug = page?.slug ? `/${page.slug}` : "/";
    return `${LANDING_URL}${slug}?lp_preview=1`;
  }, [page?.slug]);

  const deviceWidth = device === "desktop" ? "100%" : device === "tablet" ? "768px" : "390px";

  if (draftQuery.isLoading || !doc) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[70vh] w-full" />
      </div>
    );
  }

  function patchPage(next: Page) {
    updateDoc((d) => ({
      ...d,
      pages: d.pages.map((p) => (p.id === next.id ? next : p)),
    }));
  }

  function patchSection(next: Section) {
    if (!page) return;
    patchPage({
      ...page,
      sections: page.sections.map((s) => (s.id === next.id ? next : s)),
    });
  }

  async function onPublish() {
    if (!doc) return;
    try {
      const res = await publishMut.mutateAsync({ content: doc, note: publishNote });
      setDirty(false);
      setPublishNote("");
      toast({ title: `Published v${res.version.version}` });
      utils.landing.getDraft.invalidate();
      utils.landing.listVersions.invalidate();
      utils.landing.rebuildStatus.invalidate();
      utils.platform.recentAudit.invalidate();
    } catch (err) {
      toast({
        title: "Publish failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        kicker="Landing"
        title="Landing Page Controls"
        description="Edit the marketing site. Drafts autosave. Publish pushes live and schedules a rebuild."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {saving ? "Saving…" : dirty ? "Unsaved changes" : "Draft saved"}
            </span>
            <TacticalButton
              size="sm"
              variant="outline"
              onClick={async () => {
                const { token } = await previewToken.mutateAsync();
                window.open(`${LANDING_URL}/?lp_preview_token=${encodeURIComponent(token)}`, "_blank");
              }}
            >
              <Eye className="h-3.5 w-3.5" />
              Preview tab
            </TacticalButton>
            <TacticalButton
              size="sm"
              variant="outline"
              disabled={discardMut.isPending}
              onClick={async () => {
                const res = await discardMut.mutateAsync();
                setDoc(deepClone(res.content));
                setDirty(false);
                toast({ title: "Draft reset to published" });
              }}
            >
              <Redo2 className="h-3.5 w-3.5" />
              Discard
            </TacticalButton>
            <TacticalButton size="sm" disabled={publishMut.isPending} onClick={() => void onPublish()}>
              {publishMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UploadCloud className="h-3.5 w-3.5" />}
              Publish
            </TacticalButton>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-2">
        <Input
          value={publishNote}
          onChange={(e) => setPublishNote(e.target.value)}
          placeholder="Publish note (optional)"
          className="h-9 max-w-sm text-sm"
        />
        {rebuild.data ? (
          <span className="text-[11px] text-muted-foreground">
            Rebuild: {rebuild.data.status}
            {rebuild.data.detail ? ` — ${rebuild.data.detail}` : ""}
          </span>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="editor">Editor</TabsTrigger>
          <TabsTrigger value="pages">Pages</TabsTrigger>
          <TabsTrigger value="global">Global</TabsTrigger>
          <TabsTrigger value="media">Media</TabsTrigger>
          <TabsTrigger value="versions">Versions</TabsTrigger>
        </TabsList>

        <TabsContent value="editor" className="mt-4">
          <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_320px]">
            {/* Left: pages + sections */}
            <Panel title="Sections" contentClassName="space-y-3 p-3" className="min-h-[70vh]">
              <select
                className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"
                value={pageId}
                onChange={(e) => {
                  setPageId(e.target.value);
                  const p = doc.pages.find((x) => x.id === e.target.value);
                  setSectionId(p?.sections[0]?.id ?? null);
                }}
              >
                {doc.pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title || p.slug || "Home"}
                  </option>
                ))}
              </select>

              {page ? (
                <SortableList
                  items={page.sections}
                  getKey={(s) => s.id}
                  onReorder={(sections) => patchPage({ ...page, sections })}
                >
                  {(s, _i, handle) => (
                    <div
                      className={cn(
                        "flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs",
                        sectionId === s.id ? "border-primary/40 bg-primary/10" : "border-border/60",
                      )}
                    >
                      {handle}
                      <button
                        type="button"
                        className="min-w-0 flex-1 truncate text-left font-medium"
                        onClick={() => setSectionId(s.id)}
                      >
                        {PRESET_MAP[s.type]?.label || (s.type === CUSTOM_SECTION ? "Custom" : s.type)}
                        {s.hidden ? " (hidden)" : ""}
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-muted"
                        onClick={() => patchSection({ ...s, hidden: !s.hidden })}
                        title={s.hidden ? "Show" : "Hide"}
                      >
                        {s.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-muted"
                        onClick={() => {
                          const copy: Section = { ...deepClone(s), id: newId("sec") };
                          patchPage({ ...page, sections: [...page.sections, copy] });
                          setSectionId(copy.id);
                        }}
                        title="Duplicate"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 hover:bg-muted"
                        onClick={() => {
                          const next = page.sections.filter((x) => x.id !== s.id);
                          patchPage({ ...page, sections: next });
                          if (sectionId === s.id) setSectionId(next[0]?.id ?? null);
                        }}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </SortableList>
              ) : null}

              <Button type="button" size="sm" variant="outline" className="w-full" onClick={() => setShowAdd((v) => !v)}>
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add section
              </Button>
              {showAdd && page ? (
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
                  <button
                    type="button"
                    className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                    onClick={() => {
                      const s: Section = {
                        id: newId("sec"),
                        type: CUSTOM_SECTION,
                        hidden: false,
                        props: {},
                        style: {},
                        blocks: [],
                      };
                      patchPage({ ...page, sections: [...page.sections, s] });
                      setSectionId(s.id);
                      setMode("advanced");
                      setShowAdd(false);
                    }}
                  >
                    Custom section (blocks)
                  </button>
                  {PRESETS.filter((p) => p.category !== "page").map((preset) => (
                    <button
                      key={preset.type}
                      type="button"
                      className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                      onClick={() => {
                        const s = { ...presetSection(preset.type, newId("sec")) };
                        patchPage({ ...page, sections: [...page.sections, s] });
                        setSectionId(s.id);
                        setShowAdd(false);
                      }}
                    >
                      {preset.label}
                      <span className="block text-[10px] text-muted-foreground">{preset.description}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </Panel>

            {/* Center: preview */}
            <Panel
              title="Live preview"
              actions={
                <div className="flex items-center gap-1">
                  {(
                    [
                      ["desktop", Monitor],
                      ["tablet", Laptop],
                      ["mobile", Smartphone],
                    ] as const
                  ).map(([id, Icon]) => (
                    <Button
                      key={id}
                      type="button"
                      size="icon"
                      variant={device === id ? "secondary" : "ghost"}
                      className="h-8 w-8"
                      onClick={() => setDevice(id)}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </Button>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs"
                    onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
                  >
                    {theme}
                  </Button>
                </div>
              }
              contentClassName="flex justify-center bg-muted/20 p-3"
              className="min-h-[70vh]"
            >
              <iframe
                ref={iframeRef}
                title="Landing preview"
                src={previewSrc}
                className="h-[70vh] rounded-lg border bg-background shadow-sm transition-[width]"
                style={{ width: deviceWidth, maxWidth: "100%" }}
              />
            </Panel>

            {/* Right: inspector */}
            <Panel
              title="Inspector"
              actions={
                <div className="flex rounded-md border p-0.5 text-[11px]">
                  <button
                    type="button"
                    className={cn("rounded px-2 py-1", mode === "simple" && "bg-primary/15 font-semibold")}
                    onClick={() => setMode("simple")}
                  >
                    Simple
                  </button>
                  <button
                    type="button"
                    className={cn("rounded px-2 py-1", mode === "advanced" && "bg-primary/15 font-semibold")}
                    onClick={() => setMode("advanced")}
                  >
                    Advanced
                  </button>
                </div>
              }
              contentClassName="max-h-[70vh] space-y-4 overflow-y-auto p-3"
            >
              {!section ? (
                <p className="text-xs text-muted-foreground">Select a section</p>
              ) : (
                <>
                  <p className="text-xs font-semibold">
                    {PRESET_MAP[section.type]?.label || section.type}
                  </p>
                  {section.type !== CUSTOM_SECTION && (PRESET_MAP[section.type]?.fields.length ?? 0) > 0 ? (
                    <FieldForm
                      fields={PRESET_MAP[section.type]!.fields}
                      values={section.props}
                      onChange={(props) => patchSection({ ...section, props })}
                    />
                  ) : null}
                  {section.type === CUSTOM_SECTION || mode === "advanced" ? (
                    <BlockEditor
                      section={section}
                      onChange={patchSection}
                      advanced={mode === "advanced"}
                    />
                  ) : null}
                  {mode === "advanced" ? (
                    <>
                      <div className="border-t pt-3">
                        <p className="mb-2 text-xs font-semibold">Style</p>
                        <FieldForm
                          fields={STYLE_FIELDS}
                          values={section.style as Record<string, unknown>}
                          onChange={(style) => patchSection({ ...section, style: style as Section["style"] })}
                        />
                      </div>
                      <div className="border-t pt-3">
                        <p className="mb-2 text-xs font-semibold">Raw JSON</p>
                        <div className="overflow-hidden rounded-md border">
                          <Editor
                            height="220px"
                            defaultLanguage="json"
                            theme="vs-dark"
                            value={JSON.stringify(section, null, 2)}
                            options={{ minimap: { enabled: false }, fontSize: 11 }}
                            onChange={(value) => {
                              if (!value) return;
                              try {
                                const parsed = JSON.parse(value) as Section;
                                if (parsed.id === section.id) patchSection(parsed);
                              } catch {
                                /* typing */
                              }
                            }}
                          />
                        </div>
                      </div>
                    </>
                  ) : null}
                </>
              )}
            </Panel>
          </div>
        </TabsContent>

        <TabsContent value="pages" className="mt-4">
          <PagesPanel
            doc={doc}
            pageId={pageId}
            onSelect={setPageId}
            onChange={(pages) => updateDoc((d) => ({ ...d, pages }))}
          />
        </TabsContent>

        <TabsContent value="global" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Brand & contact">
              <FieldForm
                fields={SETTINGS_FIELDS}
                values={doc.settings as unknown as Record<string, unknown>}
                onChange={(settings) =>
                  updateDoc((d) => ({ ...d, settings: settings as SiteDocument["settings"] }))
                }
              />
            </Panel>
            <div className="space-y-4">
              <Panel title="Navigation">
                <FieldForm
                  fields={NAV_FIELDS}
                  values={doc.nav as unknown as Record<string, unknown>}
                  onChange={(nav) => updateDoc((d) => ({ ...d, nav: nav as SiteDocument["nav"] }))}
                />
              </Panel>
              <Panel title="Footer">
                <FieldForm
                  fields={FOOTER_FIELDS}
                  values={doc.footer as unknown as Record<string, unknown>}
                  onChange={(footer) =>
                    updateDoc((d) => ({ ...d, footer: footer as SiteDocument["footer"] }))
                  }
                />
              </Panel>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="media" className="mt-4">
          <Panel title="Media library" description="Uploads are stored by the app and served from /api/public/landing/media/…">
            <MediaLibrary />
          </Panel>
        </TabsContent>

        <TabsContent value="versions" className="mt-4">
          <Panel title="Published versions" kicker="History">
            <div className="space-y-2">
              {(versions.data ?? []).map((v) => (
                <div
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/70 px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">v{v.version}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(v.publishedAt).toLocaleString()}
                      {v.note ? ` — ${v.note}` : ""}
                    </p>
                  </div>
                  <TacticalButton
                    size="sm"
                    variant="outline"
                    disabled={restoreMut.isPending}
                    onClick={async () => {
                      const res = await restoreMut.mutateAsync({ version: v.version });
                      setDoc(deepClone(res.content));
                      setDirty(true);
                      toast({ title: `Restored v${v.version} into draft` });
                    }}
                  >
                    <History className="h-3.5 w-3.5" />
                    Restore to draft
                  </TacticalButton>
                </div>
              ))}
              {!versions.isLoading && (versions.data?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No publishes yet. The live site is using built-in defaults.</p>
              ) : null}
            </div>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function BlockEditor({
  section,
  onChange,
  advanced,
}: {
  section: Section;
  onChange: (s: Section) => void;
  advanced: boolean;
}) {
  if (section.type !== CUSTOM_SECTION && !advanced) return null;
  if (section.type !== CUSTOM_SECTION) return null;

  function updateBlocks(blocks: Block[]) {
    onChange({ ...section, blocks });
  }

  return (
    <div className="space-y-3 border-t pt-3">
      <p className="text-xs font-semibold">Blocks</p>
      <SortableList items={section.blocks} getKey={(b) => b.id} onReorder={updateBlocks}>
        {(block, _i, handle) => (
          <div className="space-y-2 rounded-lg border border-border/70 p-2">
            <div className="flex items-center gap-1">
              {handle}
              <span className="flex-1 text-xs font-medium">{BLOCK_MAP[block.type]?.label || block.type}</span>
              <button
                type="button"
                className="rounded p-1 hover:bg-muted"
                onClick={() => updateBlocks(section.blocks.filter((b) => b.id !== block.id))}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <FieldForm
              fields={BLOCK_MAP[block.type]?.fields ?? []}
              values={block.props}
              onChange={(props) =>
                updateBlocks(section.blocks.map((b) => (b.id === block.id ? { ...b, props } : b)))
              }
            />
            {advanced ? (
              <FieldForm
                fields={STYLE_FIELDS}
                values={block.style as Record<string, unknown>}
                onChange={(style) =>
                  updateBlocks(
                    section.blocks.map((b) =>
                      b.id === block.id ? { ...b, style: style as Block["style"] } : b,
                    ),
                  )
                }
              />
            ) : null}
          </div>
        )}
      </SortableList>
      <div className="flex flex-wrap gap-1">
        {BLOCKS.map((b) => (
          <Button
            key={b.type}
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => {
              const block: Block = {
                id: newId("blk"),
                type: b.type,
                props: deepClone(b.defaults),
                style: {},
                children: [],
              };
              updateBlocks([...section.blocks, block]);
            }}
          >
            <Plus className="mr-1 h-3 w-3" />
            {b.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function PagesPanel({
  doc,
  pageId,
  onSelect,
  onChange,
}: {
  doc: SiteDocument;
  pageId: string;
  onSelect: (id: string) => void;
  onChange: (pages: Page[]) => void;
}) {
  const page = doc.pages.find((p) => p.id === pageId);
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <Panel title="Pages" contentClassName="space-y-2 p-3">
        {doc.pages.map((p) => (
          <button
            key={p.id}
            type="button"
            className={cn(
              "block w-full rounded-lg border px-3 py-2 text-left text-sm",
              pageId === p.id ? "border-primary/40 bg-primary/10" : "border-border/60",
            )}
            onClick={() => onSelect(p.id)}
          >
            <span className="font-medium">{p.title}</span>
            <span className="block text-[11px] text-muted-foreground">/{p.slug || ""}</span>
          </button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => {
            const id = newId("page");
            const p: Page = {
              id,
              slug: `page-${id.slice(-4)}`,
              title: "New page",
              hidden: false,
              seo: { title: "", description: "" },
              sections: [
                {
                  id: newId("sec"),
                  type: CUSTOM_SECTION,
                  hidden: false,
                  props: {},
                  style: {},
                  blocks: [
                    {
                      id: newId("blk"),
                      type: "heading",
                      props: { text: "New page", level: "h1" },
                      style: {},
                      children: [],
                    },
                  ],
                },
              ],
            };
            onChange([...doc.pages, p]);
            onSelect(id);
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          New page
        </Button>
      </Panel>
      {page ? (
        <Panel title={page.title} description="Slug, SEO and visibility">
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Title</label>
              <Input
                value={page.title}
                onChange={(e) =>
                  onChange(doc.pages.map((p) => (p.id === page.id ? { ...p, title: e.target.value } : p)))
                }
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Slug (empty = home)</label>
              <Input
                value={page.slug}
                disabled={page.slug === "" && doc.pages.filter((p) => p.slug === "").length === 1}
                onChange={(e) =>
                  onChange(
                    doc.pages.map((p) =>
                      p.id === page.id ? { ...p, slug: e.target.value.replace(/^\/+/, "") } : p,
                    ),
                  )
                }
              />
            </div>
            <FieldForm
              fields={PAGE_SEO_FIELDS}
              values={page.seo as unknown as Record<string, unknown>}
              onChange={(seo) =>
                onChange(
                  doc.pages.map((p) =>
                    p.id === page.id ? { ...p, seo: seo as Page["seo"] } : p,
                  ),
                )
              }
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  onChange(
                    doc.pages.map((p) => (p.id === page.id ? { ...p, hidden: !p.hidden } : p)),
                  )
                }
              >
                {page.hidden ? "Unhide page" : "Hide page"}
              </Button>
              {page.slug !== "" ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    const next = doc.pages.filter((p) => p.id !== page.id);
                    onChange(next);
                    onSelect(next[0]?.id ?? "home");
                  }}
                >
                  Delete page
                </Button>
              ) : null}
            </div>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
