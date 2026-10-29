/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useOrg } from "@/components/org-provider";
import { useProject } from "@/components/project-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { trpc } from "@/lib/trpc/client";
import { Copy, FileText, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function InterviewFormsPage() {
  const { currentOrg } = useOrg();
  const projectCtx = useProject() as { currentProject?: { id: string } | null };
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const list = trpc.interviewForm.list.useQuery({ organizationId: currentOrg?.id ?? "" }, { enabled: !!currentOrg?.id });
  const create = trpc.interviewForm.create.useMutation({
    onSuccess: (f) => router.push(`/integrations/forms/${f.id}`),
    onError: (e) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const dup = trpc.interviewForm.duplicate.useMutation({ onSuccess: () => list.refetch() });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Interview Forms</h1>
        <p className="text-sm text-muted-foreground">Build candidate application forms, attach an AI interview, publish, and integrate via API or a hosted form.</p>
        <div className="mt-2 flex gap-3 text-sm">
          <Link className="text-primary underline" href="/integrations/api-keys">Manage API keys</Link>
          <Link className="text-primary underline" href="/integrations">How to connect (API, embed, MCP)</Link>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">Create a form</CardTitle><CardDescription>Starts from the recommended template (name, email, phone, resume, cover letter, experience, skills, portfolio, documents, consent). Everything is editable.</CardDescription></CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="e.g. Flutter Developer – Q4 hiring" value={name} onChange={(e) => setName(e.target.value)} />
          <Button disabled={!name.trim() || !currentOrg || create.isLoading} onClick={() => create.mutate({ organizationId: currentOrg!.id, projectId: projectCtx.currentProject?.id, name: name.trim(), template: "default" })}>
            {create.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}Create
          </Button>
        </CardContent>
      </Card>
      <div className="grid gap-3">
        {list.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
        {list.data?.length === 0 && <p className="text-sm text-muted-foreground">No forms yet.</p>}
        {list.data?.map((f: any) => (
          <Card key={f.id}>
            <CardContent className="flex flex-wrap items-center gap-3 py-4">
              <FileText className="h-5 w-5 text-muted-foreground" />
              <div className="flex-1">
                <Link href={`/integrations/forms/${f.id}`} className="font-medium hover:underline">{f.name}</Link>
                <div className="text-xs text-muted-foreground">{f.fieldCount} fields · {f.applicationCount} submissions · <code>{f.publicId}</code> · updated {new Date(f.updatedAt).toLocaleDateString()}</div>
              </div>
              <Badge variant={f.status === "published" ? "default" : "secondary"}>{f.status}</Badge>
              <Button size="sm" variant="ghost" onClick={() => dup.mutate({ id: f.id })}><Copy className="mr-1 h-3.5 w-3.5" />Duplicate</Button>
              <Button size="sm" variant="outline" asChild><Link href={`/integrations/forms/${f.id}`}>Edit</Link></Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
