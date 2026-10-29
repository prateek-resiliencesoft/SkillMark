"use client";

import { FormBuilder } from "@/components/integrations/form-builder";
import { useParams } from "next/navigation";

export default function InterviewFormBuilderPage() {
  const { id } = useParams<{ id: string }>();
  return <FormBuilder formId={id} />;
}
