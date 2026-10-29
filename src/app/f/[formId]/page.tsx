"use client";

import { Suspense } from "react";
import { DynamicForm } from "@/components/integrations/dynamic-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { FormField } from "@/lib/forms/schema";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

interface PublicForm {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[];
  settings: { successMessage: string | null; redirectToInterview: boolean };
  interview: { title: string; durationMinutes: number | null };
}

/** Hosted candidate application form: /f/{formId} (embed with ?embed=1). */
function HostedFormPageInner() {
  const { formId } = useParams<{ formId: string }>();
  const embed = useSearchParams().get("embed") === "1";
  const [form, setForm] = useState<PublicForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [done, setDone] = useState<{ url: string | null } | null>(null);

  useEffect(() => {
    fetch(`/api/public/forms/${encodeURIComponent(formId)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error?.message || "Form not available");
        setForm(j.data);
      })
      .catch((e) => setLoadError(e.message));
  }, [formId]);

  const onSubmit = async (fd: FormData) => {
    const r = await fetch(`/api/public/forms/${encodeURIComponent(formId)}`, { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { errors: j?.error?.details, message: j?.error?.message || "Submission failed" };
    const url: string | null = j?.data?.interview_url ?? null;
    setDone({ url });
    if (url && form?.settings.redirectToInterview) {
      const target = embed ? window.top ?? window : window;
      setTimeout(() => { try { target.location.href = url; } catch { window.location.href = url; } }, 2500);
    }
  };

  return (
    <div className={embed ? "p-3" : "flex min-h-screen items-start justify-center bg-muted/30 p-4 sm:p-10"}>
      <Card className="w-full max-w-xl">
        {!form && !loadError && (
          <CardContent className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></CardContent>
        )}
        {loadError && <CardContent className="py-16 text-center text-sm text-muted-foreground">{loadError}</CardContent>}
        {form && !done && (
          <>
            <CardHeader>
              <CardTitle>{form.interview.title || form.name}</CardTitle>
              <CardDescription>
                {form.description || "Fill in your details to start the AI interview."}
                {form.interview.durationMinutes ? ` Interview length: ~${form.interview.durationMinutes} min.` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DynamicForm fields={form.fields} onSubmit={onSubmit} />
            </CardContent>
          </>
        )}
        {done && (
          <CardContent className="py-12 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-600" />
            <h2 className="mt-4 text-xl font-semibold">Application submitted</h2>
            <p className="mt-2 text-sm text-muted-foreground">{form?.settings.successMessage || "Thank you for applying."}</p>
            {done.url && (
              <a href={done.url} target={embed ? "_top" : undefined} className="mt-5 inline-block rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                Start interview
              </a>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

export default function HostedFormPage() {
  return (
    <Suspense fallback={null}>
      <HostedFormPageInner />
    </Suspense>
  );
}
