import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertMinRole, getOrgMembership, protectedProcedure, router } from "../trpc";

export const DEFAULT_QUESTION_BANK_SECTIONS = [
  {
    name: "Screening Round",
    description: "Introductory questions to assess background, communication, and basic fit.",
    order: 0,
    questions: [
      {
        text: "Please introduce yourself and walk us through your most relevant work experience.",
        type: "OPEN_ENDED",
        description: "Assess verbal communication clarity and core background fit.",
        order: 0,
      },
      {
        text: "What are your timeline, notice period, and expectations for your next role?",
        type: "OPEN_ENDED",
        description: "Verify availability, location, and role expectations.",
        order: 1,
      },
    ],
  },
  {
    name: "Technical Round",
    description: "Core technical questions to evaluate engineering problem-solving and domain competence.",
    order: 1,
    questions: [
      {
        text: "Walk through an end-to-end technical project you built or led. What architectural trade-offs did you make?",
        type: "OPEN_ENDED",
        description: "Evaluates architectural judgment, system thinking, and decision making.",
        order: 0,
      },
      {
        text: "How do you identify, profile, and fix performance bottlenecks in complex production systems?",
        type: "OPEN_ENDED",
        description: "Evaluates debugging depth, observability, and production rigor.",
        order: 1,
      },
    ],
  },
  {
    name: "HR Round",
    description: "Culture, collaboration, conflict resolution, and behavioral alignment.",
    order: 2,
    questions: [
      {
        text: "Describe a situation where you had a disagreement with a teammate or stakeholder. How did you resolve it?",
        type: "OPEN_ENDED",
        description: "Evaluates conflict resolution, empathy, and professional maturity.",
        order: 0,
      },
      {
        text: "What type of team culture and work environment enables you to perform at your best?",
        type: "OPEN_ENDED",
        description: "Assesses values alignment and working style compatibility.",
        order: 1,
      },
    ],
  },
];

async function seedDefaultSections(
  supabase: Parameters<typeof getOrgMembership>[0],
  organizationId: string,
) {
  for (const s of DEFAULT_QUESTION_BANK_SECTIONS) {
    const { data: section, error: secErr } = await supabase
      .from("question_bank_sections")
      .insert({
        organizationId,
        name: s.name,
        description: s.description,
        order: s.order,
        isEnabled: true,
      })
      .select("id")
      .single();

    if (secErr || !section) continue;

    const itemsToInsert = s.questions.map((q) => ({
      sectionId: section.id,
      organizationId,
      text: q.text,
      description: q.description,
      type: q.type,
      order: q.order,
      isEnabled: true,
    }));

    await supabase.from("question_bank_items").insert(itemsToInsert);
  }
}

export const questionBankRouter = router({
  list: protectedProcedure
    .input(z.object({ organizationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
      );
      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You are not a member of this organization",
        });
      }

      // Check if sections already exist
      const { data: existingSections, error: listErr } = await ctx.supabase
        .from("question_bank_sections")
        .select("*")
        .eq("organizationId", input.organizationId)
        .order("order", { ascending: true });

      if (listErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: listErr.message,
        });
      }

      let sections = existingSections ?? [];

      // Auto-seed if brand new organization with 0 sections
      if (sections.length === 0) {
        await seedDefaultSections(ctx.supabase, input.organizationId);
        const { data: seeded } = await ctx.supabase
          .from("question_bank_sections")
          .select("*")
          .eq("organizationId", input.organizationId)
          .order("order", { ascending: true });
        sections = seeded ?? [];
      }

      // Fetch all items for this organization
      const { data: items, error: itemsErr } = await ctx.supabase
        .from("question_bank_items")
        .select("*")
        .eq("organizationId", input.organizationId)
        .order("order", { ascending: true });

      if (itemsErr) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: itemsErr.message,
        });
      }

      // Group items by sectionId
      const sectionsWithItems = sections.map((sec) => ({
        ...sec,
        items: (items ?? []).filter((item) => item.sectionId === sec.id),
      }));

      return sectionsWithItems;
    }),

  createSection: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        name: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
      );
      if (!membership) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      assertMinRole(membership.role, "MEMBER");

      const { data: maxOrderRow } = await ctx.supabase
        .from("question_bank_sections")
        .select("order")
        .eq("organizationId", input.organizationId)
        .order("order", { ascending: false })
        .limit(1)
        .single();

      const nextOrder = (maxOrderRow?.order ?? -1) + 1;

      const { data: section, error } = await ctx.supabase
        .from("question_bank_sections")
        .insert({
          organizationId: input.organizationId,
          name: input.name,
          description: input.description ?? null,
          order: nextOrder,
          isEnabled: true,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }
      return section;
    }),

  updateSection: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        isEnabled: z.boolean().optional(),
        order: z.number().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: sec } = await ctx.supabase
        .from("question_bank_sections")
        .select("organizationId")
        .eq("id", input.id)
        .single();

      if (!sec) throw new TRPCError({ code: "NOT_FOUND" });

      const membership = await getOrgMembership(
        ctx.supabase,
        sec.organizationId,
        ctx.user.id,
      );
      if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
      assertMinRole(membership.role, "MEMBER");

      const { id, ...updates } = input;
      const { data: updated, error } = await ctx.supabase
        .from("question_bank_sections")
        .update({
          ...updates,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }
      return updated;
    }),

  deleteSection: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data: sec } = await ctx.supabase
        .from("question_bank_sections")
        .select("organizationId")
        .eq("id", input.id)
        .single();

      if (!sec) throw new TRPCError({ code: "NOT_FOUND" });

      const membership = await getOrgMembership(
        ctx.supabase,
        sec.organizationId,
        ctx.user.id,
      );
      if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
      assertMinRole(membership.role, "MEMBER");

      const { error } = await ctx.supabase
        .from("question_bank_sections")
        .delete()
        .eq("id", input.id);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }
      return { success: true };
    }),

  createItem: protectedProcedure
    .input(
      z.object({
        sectionId: z.string(),
        organizationId: z.string(),
        text: z.string().min(1),
        description: z.string().nullable().optional(),
        type: z
          .enum([
            "OPEN_ENDED",
            "SINGLE_CHOICE",
            "MULTIPLE_CHOICE",
            "CODING",
            "WHITEBOARD",
            "RESEARCH",
          ])
          .default("OPEN_ENDED"),
        options: z.any().optional(),
        starterCode: z
          .object({ language: z.string(), code: z.string() })
          .nullable()
          .optional(),
        followUpPrompts: z.any().optional(),
        isEnabled: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
      );
      if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
      assertMinRole(membership.role, "MEMBER");

      const { data: maxOrderRow } = await ctx.supabase
        .from("question_bank_items")
        .select("order")
        .eq("sectionId", input.sectionId)
        .order("order", { ascending: false })
        .limit(1)
        .single();

      const nextOrder = (maxOrderRow?.order ?? -1) + 1;

      const { data: item, error } = await ctx.supabase
        .from("question_bank_items")
        .insert({
          sectionId: input.sectionId,
          organizationId: input.organizationId,
          text: input.text,
          description: input.description ?? null,
          type: input.type,
          options: input.options ?? null,
          starterCode: input.starterCode ?? null,
          followUpPrompts: input.followUpPrompts ?? null,
          order: nextOrder,
          isEnabled: input.isEnabled,
        })
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }
      return item;
    }),

  updateItem: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        text: z.string().min(1).optional(),
        description: z.string().nullable().optional(),
        type: z.string().optional(),
        options: z.any().optional(),
        starterCode: z.any().optional(),
        followUpPrompts: z.any().optional(),
        isEnabled: z.boolean().optional(),
        order: z.number().optional(),
        sectionId: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { data: itm } = await ctx.supabase
        .from("question_bank_items")
        .select("organizationId")
        .eq("id", input.id)
        .single();

      if (!itm) throw new TRPCError({ code: "NOT_FOUND" });

      const membership = await getOrgMembership(
        ctx.supabase,
        itm.organizationId,
        ctx.user.id,
      );
      if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
      assertMinRole(membership.role, "MEMBER");

      const { id, ...updates } = input;
      const { data: updated, error } = await ctx.supabase
        .from("question_bank_items")
        .update({
          ...updates,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }
      return updated;
    }),

  toggleItem: protectedProcedure
    .input(z.object({ id: z.string(), isEnabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { data: itm } = await ctx.supabase
        .from("question_bank_items")
        .select("organizationId")
        .eq("id", input.id)
        .single();

      if (!itm) throw new TRPCError({ code: "NOT_FOUND" });

      const membership = await getOrgMembership(
        ctx.supabase,
        itm.organizationId,
        ctx.user.id,
      );
      if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
      assertMinRole(membership.role, "MEMBER");

      const { data: updated, error } = await ctx.supabase
        .from("question_bank_items")
        .update({
          isEnabled: input.isEnabled,
          updatedAt: new Date().toISOString(),
        })
        .eq("id", input.id)
        .select()
        .single();

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }
      return updated;
    }),

  deleteItem: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { data: itm } = await ctx.supabase
        .from("question_bank_items")
        .select("organizationId")
        .eq("id", input.id)
        .single();

      if (!itm) throw new TRPCError({ code: "NOT_FOUND" });

      const membership = await getOrgMembership(
        ctx.supabase,
        itm.organizationId,
        ctx.user.id,
      );
      if (!membership) throw new TRPCError({ code: "FORBIDDEN" });
      assertMinRole(membership.role, "MEMBER");

      const { error } = await ctx.supabase
        .from("question_bank_items")
        .delete()
        .eq("id", input.id);

      if (error) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: error.message,
        });
      }
      return { success: true };
    }),

  getEnabledQuestions: protectedProcedure
    .input(
      z.object({
        organizationId: z.string(),
        sectionIds: z.array(z.string()).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const membership = await getOrgMembership(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
      );
      if (!membership) return { sections: [], questions: [] };

      // Query active sections
      let secQuery = ctx.supabase
        .from("question_bank_sections")
        .select("id, name, order, isEnabled")
        .eq("organizationId", input.organizationId)
        .eq("isEnabled", true)
        .order("order", { ascending: true });

      if (input.sectionIds && input.sectionIds.length > 0) {
        secQuery = secQuery.in("id", input.sectionIds);
      }

      const { data: sections } = await secQuery;
      if (!sections || sections.length === 0) {
        return { sections: [], questions: [] };
      }

      const activeSecIds = sections.map((s) => s.id);
      const { data: items } = await ctx.supabase
        .from("question_bank_items")
        .select("*")
        .in("sectionId", activeSecIds)
        .eq("isEnabled", true)
        .order("order", { ascending: true });

      const secMap = new Map(sections.map((s) => [s.id, s.name]));

      const questions = (items ?? []).map((q) => ({
        ...q,
        sectionName: secMap.get(q.sectionId) ?? "Standard",
      }));

      return {
        sections,
        questions,
      };
    }),
});
