import { sanitizeTaskModels, type AiTaskModelsStored } from "@/lib/ai/credentials";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { platformProcedure, router } from "../trpc";

const hopSchema = z.object({
  provider: z.enum(["openai", "gemini", "nvidia", "anthropic", "groq", "custom"]),
  model: z.string().trim().min(1).max(200),
});

const payloadSchema = z.object({
  // String keys — sanitizeTaskModels keeps only known AiTaskKind entries.
  taskModels: z.record(z.string(), z.array(hopSchema).max(12)).optional(),
  routing: z
    .record(z.string(), z.array(z.enum(["openai", "gemini", "nvidia", "anthropic", "groq", "custom"])))
    .optional(),
});

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || `preset-${Date.now()}`;
}

export const aiPresetsRouter = router({
  list: platformProcedure.query(async () => {
    const { data, error } = await supabaseAdmin
      .from("ai_preset_templates")
      .select("id, slug, name, blurb, published, payload, \"createdAt\", \"updatedAt\"")
      .order("updatedAt", { ascending: false });
    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),

  upsert: platformProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().trim().min(1).max(120),
        blurb: z.string().max(500).optional(),
        published: z.boolean().optional(),
        payload: payloadSchema,
        slug: z.string().trim().min(1).max(64).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const taskModels = sanitizeTaskModels(input.payload.taskModels ?? {}) as AiTaskModelsStored;
      const payload = {
        taskModels,
        routing: input.payload.routing ?? {},
      };
      const row = {
        name: input.name,
        blurb: input.blurb ?? "",
        published: input.published ?? false,
        payload,
        slug: input.slug?.trim() || slugify(input.name),
        updatedAt: new Date().toISOString(),
        createdBy: ctx.user.id,
      };
      if (input.id) {
        const { data, error } = await supabaseAdmin
          .from("ai_preset_templates")
          .update(row)
          .eq("id", input.id)
          .select("id")
          .maybeSingle();
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
        if (!data) throw new TRPCError({ code: "NOT_FOUND", message: "Preset not found" });
        return { id: data.id };
      }
      const { data, error } = await supabaseAdmin
        .from("ai_preset_templates")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { id: data.id as string };
    }),

  setPublished: platformProcedure
    .input(z.object({ id: z.string().uuid(), published: z.boolean() }))
    .mutation(async ({ input }) => {
      const { error } = await supabaseAdmin
        .from("ai_preset_templates")
        .update({ published: input.published, updatedAt: new Date().toISOString() })
        .eq("id", input.id);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true };
    }),

  delete: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const { error } = await supabaseAdmin.from("ai_preset_templates").delete().eq("id", input.id);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { ok: true };
    }),
});
