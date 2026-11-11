/**
 * Organization billing — plan status, Stripe Checkout, customer portal.
 * When Stripe env is unset, status still works; checkout returns a clear message.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  formatLimit,
  planEntry,
  stripePriceIdForPlan,
} from "@/lib/billing/catalog";
import {
  createBillingPortalSession,
  createCheckoutSession,
  createStripeCustomer,
  isStripeBillingEnabled,
} from "@/lib/billing/stripe";
import { loadPlatformSettings } from "../platform-settings";
import { loadOrgLimits } from "../quotas";
import { requireOrgAccess } from "../tenant";
import { protectedProcedure, router } from "../trpc";

export const billingRouter = router({
  status: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireOrgAccess(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
        { minRole: "VIEWER" },
      );

      const { data: org } = await ctx.supabase
        .from("organizations")
        .select(
          "id, name, plan, status, limits, stripeCustomerId, stripeSubscriptionId, billingEmail",
        )
        .eq("id", input.organizationId)
        .maybeSingle();

      if (!org) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const [{ plan, limits }, platform] = await Promise.all([
        loadOrgLimits(ctx.supabase, input.organizationId),
        loadPlatformSettings(ctx.supabase),
      ]);
      const catalog = platform.planCatalog;
      const entry = planEntry(plan, catalog);
      const stripeOn = isStripeBillingEnabled();

      return {
        organizationId: org.id as string,
        organizationName: org.name as string,
        plan,
        planName: entry.name,
        planBlurb: entry.blurb,
        status: (org.status as string) ?? "ACTIVE",
        limits: {
          seats: limits.seats,
          interviews: limits.interviews,
          projects: limits.projects,
          seatsLabel: formatLimit(limits.seats),
          interviewsLabel: formatLimit(limits.interviews),
          projectsLabel: formatLimit(limits.projects),
        },
        stripeEnabled: stripeOn,
        hasCustomer: Boolean(org.stripeCustomerId),
        hasSubscription: Boolean(org.stripeSubscriptionId),
        billingEmail: (org.billingEmail as string | null) ?? null,
        catalog: catalog.map((p) => ({
          id: p.id,
          name: p.name,
          blurb: p.blurb,
          limits: p.limits,
          features: p.features,
          purchaseable:
            p.purchaseable &&
            stripeOn &&
            Boolean(stripePriceIdForPlan(p.id, catalog)),
          current: p.id === plan,
        })),
      };
    }),

  createCheckout: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        plan: z.string().trim().min(1).max(32),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isStripeBillingEnabled()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Card billing is not configured on this instance. Ask your admin.",
        });
      }

      await requireOrgAccess(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
        { minRole: "OWNER", requireActive: true },
      );

      const platform = await loadPlatformSettings(ctx.supabase);
      const planId = input.plan.trim().toUpperCase();
      const entry = platform.planCatalog.find((p) => p.id === planId);
      if (!entry?.purchaseable) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That plan cannot be purchased.",
        });
      }
      const priceId = stripePriceIdForPlan(planId, platform.planCatalog);
      if (!priceId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No Stripe price configured for ${entry.name}.`,
        });
      }

      const { data: org } = await ctx.supabase
        .from("organizations")
        .select("id, name, billingEmail, stripeCustomerId")
        .eq("id", input.organizationId)
        .maybeSingle();
      if (!org) throw new TRPCError({ code: "NOT_FOUND" });

      let customerId = org.stripeCustomerId as string | null;
      if (!customerId) {
        const email =
          (org.billingEmail as string | null) ||
          ctx.user.email ||
          "billing@example.com";
        const customer = await createStripeCustomer({
          email,
          name: org.name as string,
          organizationId: org.id as string,
        });
        customerId = customer.id;
        await ctx.supabase
          .from("organizations")
          .update({ stripeCustomerId: customerId, billingEmail: email })
          .eq("id", org.id);
      }

      const session = await createCheckoutSession({
        customerId,
        organizationId: org.id as string,
        plan: planId,
        priceId,
      });
      return { url: session.url };
    }),

  createPortal: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!isStripeBillingEnabled()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Card billing is not configured on this instance.",
        });
      }
      await requireOrgAccess(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
        { minRole: "OWNER" },
      );
      const { data: org } = await ctx.supabase
        .from("organizations")
        .select("stripeCustomerId")
        .eq("id", input.organizationId)
        .maybeSingle();
      const customerId = org?.stripeCustomerId as string | null;
      if (!customerId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No billing customer yet. Start a paid plan first.",
        });
      }
      const portal = await createBillingPortalSession({ customerId });
      return { url: portal.url };
    }),
});
