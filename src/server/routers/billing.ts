/**
 * Organization billing — plan status, Stripe Checkout, customer portal.
 * When Stripe env is unset, status still works; checkout returns a clear message.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  PLAN_CATALOG,
  formatLimit,
  planEntry,
  stripePriceIdForPlan,
  type OrgPlanId,
} from "@/lib/billing/catalog";
import {
  createBillingPortalSession,
  createCheckoutSession,
  createStripeCustomer,
  isStripeBillingEnabled,
} from "@/lib/billing/stripe";
import { loadOrgLimits } from "../quotas";
import { requireOrgAccess } from "../tenant";
import { protectedProcedure, router } from "../trpc";

const purchaseablePlan = z.enum(["PRO", "ENTERPRISE"]);

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

      const { plan, limits } = await loadOrgLimits(
        ctx.supabase,
        input.organizationId,
      );
      const entry = planEntry(plan);
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
        catalog: PLAN_CATALOG.map((p) => ({
          id: p.id,
          name: p.name,
          blurb: p.blurb,
          limits: p.limits,
          purchaseable:
            p.purchaseable &&
            stripeOn &&
            Boolean(stripePriceIdForPlan(p.id as OrgPlanId)),
          current: p.id === plan,
        })),
      };
    }),

  createCheckout: protectedProcedure
    .input(
      z.object({
        organizationId: z.string().uuid(),
        plan: purchaseablePlan,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!isStripeBillingEnabled()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Card billing is not set up on this server. Ask your platform admin to enable it, or keep using self-hosted.",
        });
      }

      const { loadPlatformSettings } = await import("../platform-settings");
      const platform = await loadPlatformSettings(ctx.supabase);
      if (!platform.instance.allowOrgSelfServeBilling) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Self-serve billing is turned off. Ask your platform admin to change the plan.",
        });
      }

      await requireOrgAccess(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
        { minRole: "OWNER", requireActive: true },
      );

      if (!stripePriceIdForPlan(input.plan)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `The ${input.plan === "PRO" ? "Pro" : "Enterprise"} plan is not available for checkout yet.`,
        });
      }

      const { data: org } = await ctx.supabase
        .from("organizations")
        .select("id, name, stripeCustomerId, billingEmail, ownerId")
        .eq("id", input.organizationId)
        .maybeSingle();

      if (!org) throw new TRPCError({ code: "NOT_FOUND" });

      let customerId = org.stripeCustomerId as string | null;
      if (!customerId) {
        const { data: owner } = await ctx.supabase
          .from("profiles")
          .select("email, name")
          .eq("id", org.ownerId)
          .maybeSingle();
        const email =
          (org.billingEmail as string | null) ||
          (owner?.email as string | null) ||
          ctx.user.email;
        if (!email) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Add a billing email on the owner account first.",
          });
        }
        const customer = await createStripeCustomer({
          email,
          name: (org.name as string) || "Resiliencesoft Interview AI organization",
          organizationId: input.organizationId,
        });
        customerId = customer.id;
        await ctx.supabase
          .from("organizations")
          .update({
            stripeCustomerId: customerId,
            billingEmail: email,
          })
          .eq("id", input.organizationId);
      }

      const session = await createCheckoutSession({
        customerId,
        organizationId: input.organizationId,
        plan: input.plan,
      });

      return { url: session.url };
    }),

  createPortal: protectedProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!isStripeBillingEnabled()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Card billing is not set up on this server.",
        });
      }

      await requireOrgAccess(
        ctx.supabase,
        input.organizationId,
        ctx.user.id,
        { minRole: "OWNER", requireActive: true },
      );

      const { data: org } = await ctx.supabase
        .from("organizations")
        .select("stripeCustomerId")
        .eq("id", input.organizationId)
        .maybeSingle();

      if (!org?.stripeCustomerId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No billing account yet. Choose a paid plan first.",
        });
      }

      const portal = await createBillingPortalSession({
        customerId: org.stripeCustomerId as string,
      });
      return { url: portal.url };
    }),
});
