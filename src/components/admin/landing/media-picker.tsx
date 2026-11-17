"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";

const BUNDLED = [
  "/screenshots/dashboard.webp",
  "/screenshots/results.webp",
  "/screenshots/candidate.webp",
  "/screenshots/candidates.webp",
  "/screenshots/new.webp",
  "/screenshots/questions.webp",
  "/screenshots/pdf.webp",
  "/images/resiliencesoft-interview-ai-logo.png",
];

function mediaUrl(id: string) {
  return `/api/public/landing/media/${id}`;
}

export function MediaPickerButton({ onPick }: { onPick: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-9 shrink-0">
          <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
          Library
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Media library</DialogTitle>
        </DialogHeader>
        <MediaLibrary
          onPick={(url) => {
            onPick(url);
            setOpen(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function MediaLibrary({ onPick }: { onPick?: (url: string) => void }) {
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const media = trpc.landing.listMedia.useQuery(undefined, { staleTime: 10_000 });
  const del = trpc.landing.deleteMedia.useMutation({
    onSuccess: () => {
      utils.landing.listMedia.invalidate();
      toast({ title: "Image removed" });
    },
    onError: (err) => {
      toast({
        title: "Could not delete image",
        description: err.message,
        variant: "destructive",
      });
    },
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [url, setUrl] = useState("");

  async function upload(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/admin/landing/media", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      await utils.landing.listMedia.invalidate();
      onPick?.(json.data.url as string);
      toast({ title: "Image uploaded" });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1.5 h-3.5 w-3.5" />}
          Upload image
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/avif,image/gif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
        <div className="flex min-w-[14rem] flex-1 gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Or paste an image URL"
            className="h-8 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!url.trim()}
            onClick={() => onPick?.(url.trim())}
          >
            Use URL
          </Button>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Uploaded
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {(media.data ?? []).map((m) => {
            const src = mediaUrl(m.id);
            return (
              <div key={m.id} className="group relative overflow-hidden rounded-lg border bg-muted/30">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <button type="button" className="block w-full" onClick={() => onPick?.(src)}>
                  <img src={src} alt={m.alt || m.fileName} className="aspect-video w-full object-cover" />
                </button>
                <button
                  type="button"
                  className="absolute right-1 top-1 hidden rounded bg-black/60 p-1 text-white group-hover:block"
                  onClick={() => del.mutate({ id: m.id })}
                  aria-label="Delete"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            );
          })}
          {media.isLoading ? <p className="col-span-full text-xs text-muted-foreground">Loading…</p> : null}
          {!media.isLoading && (media.data?.length ?? 0) === 0 ? (
            <p className="col-span-full text-xs text-muted-foreground">No uploads yet.</p>
          ) : null}
        </div>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Bundled with the site
        </p>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {BUNDLED.map((src) => (
            <button
              key={src}
              type="button"
              className="overflow-hidden rounded-lg border bg-muted/30"
              onClick={() => onPick?.(src)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`${process.env.NEXT_PUBLIC_LANDING_URL || "https://resiliencesoftinterview.com"}${src}`}
                alt={src}
                className="aspect-video w-full object-cover"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
