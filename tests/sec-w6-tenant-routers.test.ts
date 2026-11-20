/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * W6 regression tests: tenant isolation, org lifecycle and role checks in the
 * recruiter tRPC routers, upload-cv and the inbound candidate webhook.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { ctxFor, memDb } from "./sec-w6-db";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ORG_A = id(1); // attacker's own org
const ORG_B = id(2); // victim org
const ORG_S = id(3); // suspended
const ORG_D = id(4); // soft-deleted
const P_A = id(11);
const P_B = id(12);
const P_B2 = id(13); // restricted project in ORG_B
const P_S = id(14);
const P_D = id(15);
const IV_A = id(21);
const IV_B = id(22); // created by victimOwner, published
const IV_B2 = id(23); // created by member2, has a completed session
const IV_S = id(24);
const IV_R = id(25); // restricted project interview
const Q_B = id(31);
const SEC_A = id(41);
const SEC_B = id(42);
const ITEM_A = id(43);
const FORM_R = id(51);
const APP_R = id(52);
const BATCH_A = id(61);
const BATCH_B = id(62);
const BATCH_A2 = id(63);
const CAND_B = id(71);
const CAND_S = id(72);

function seed() {
  const iv = (ivId: string, projectId: string, orgId: string, userId: string, extra: Record<string, unknown> = {}) => ({
    id: ivId,
    projectId,
    userId,
    title: `Interview ${ivId.slice(-2)}`,
    isActive: true,
    publicSlug: null,
    batchId: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    project: { id: projectId, organizationId: orgId },
    ...extra,
  });
  return memDb({
    profiles: [],
    organizations: [
      { id: ORG_A, status: "ACTIVE", ownerId: "attacker" },
      { id: ORG_B, status: "ACTIVE", ownerId: "victimOwner" },
      { id: ORG_S, status: "SUSPENDED", ownerId: "attacker" },
      { id: ORG_D, status: "DELETED", ownerId: "attacker" },
    ],
    organization_members: [
      { organizationId: ORG_A, userId: "attacker", role: "OWNER" },
      { organizationId: ORG_S, userId: "attacker", role: "OWNER" },
      { organizationId: ORG_D, userId: "attacker", role: "OWNER" },
      { organizationId: ORG_D, userId: "deletedOnly", role: "OWNER" },
      { organizationId: ORG_S, userId: "suspMember", role: "MEMBER" },
      { organizationId: ORG_B, userId: "victimOwner", role: "OWNER" },
      { organizationId: ORG_B, userId: "victimAdmin", role: "ADMIN" },
      { organizationId: ORG_B, userId: "member2", role: "MEMBER" },
      { organizationId: ORG_B, userId: "viewer", role: "VIEWER" },
    ],
    projects: [
      { id: P_A, organizationId: ORG_A, name: "A" },
      { id: P_B, organizationId: ORG_B, name: "B" },
      { id: P_B2, organizationId: ORG_B, name: "B restricted" },
      { id: P_S, organizationId: ORG_S, name: "S" },
      { id: P_D, organizationId: ORG_D, name: "D" },
    ],
    project_members: [{ projectId: P_B2, userId: "victimOwner", role: "OWNER" }],
    interviews: [
      iv(IV_A, P_A, ORG_A, "attacker"),
      iv(IV_B, P_B, ORG_B, "victimOwner"),
      iv(IV_B2, P_B, ORG_B, "member2"),
      iv(IV_S, P_S, ORG_S, "attacker"),
      iv(IV_R, P_B2, ORG_B, "victimOwner"),
    ],
    questions: [{ id: Q_B, interviewId: IV_B, order: 7, text: "victim q" }],
    sessions: [
      { id: id(81), interviewId: IV_B, status: "COMPLETED", participantName: "Victim Candidate", totalDurationSeconds: 60, createdAt: new Date().toISOString() },
      { id: id(82), interviewId: IV_B2, status: "COMPLETED", participantName: "Other", totalDurationSeconds: 30, createdAt: new Date().toISOString() },
    ],
    question_bank_sections: [
      { id: SEC_A, organizationId: ORG_A, name: "A round", order: 0, isEnabled: true },
      { id: SEC_B, organizationId: ORG_B, name: "B round", order: 0, isEnabled: true },
    ],
    question_bank_items: [
      { id: ITEM_A, sectionId: SEC_A, organizationId: ORG_A, text: "own item", order: 0, isEnabled: true },
      { id: id(44), sectionId: SEC_B, organizationId: ORG_A, text: "INJECTED", order: 1, isEnabled: true },
      { id: id(45), sectionId: SEC_B, organizationId: ORG_B, text: "legit B item", order: 0, isEnabled: true },
    ],
    interview_forms: [
      { id: FORM_R, organizationId: ORG_B, projectId: P_B2, name: "Restricted form", fields: [], config: {}, settings: {}, status: "draft" },
    ],
    applications: [{ id: APP_R, organizationId: ORG_B, formId: FORM_R, files: [] }],
    interview_batches: [
      { id: BATCH_A, projectId: P_A, project: { organizationId: ORG_A } },
      { id: BATCH_A2, projectId: P_A, project: { organizationId: ORG_A } },
      { id: BATCH_B, projectId: P_B, project: { organizationId: ORG_B } },
    ],
    candidates: [
      { id: CAND_B, name: "Cand", email: null, profile: {}, interview: { id: IV_B, projectId: P_B, project: { id: P_B, organizationId: ORG_B } } },
      { id: CAND_S, name: "Cand S", email: null, profile: {}, interview: { id: IV_S, projectId: P_S, project: { id: P_S, organizationId: ORG_S } } },
    ],
    org_integrations: [{ organizationId: ORG_B, inboundWebhookSecret: "whsec_supersecretvalue123" }],
  });
}

async function rejects(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (err: any) => {
    assert.equal(err?.code, code, `expected ${code}, got ${err?.code}: ${err?.message}`);
    return true;
  });
}

let m: Record<string, any>;
before(async () => {
  m = {
    trpc: await import("../src/server/trpc"),
    orgMember: (await import("../src/server/routers/orgMember")).orgMemberRouter,
    interview: (await import("../src/server/routers/interview")).interviewRouter,
    project: (await import("../src/server/routers/project")).projectRouter,
    organization: (await import("../src/server/routers/organization")).organizationRouter,
    usage: (await import("../src/server/routers/usage")).usageRouter,
    integration: (await import("../src/server/routers/integration")).integrationRouter,
    question: (await import("../src/server/routers/question")).questionRouter,
    questionBank: (await import("../src/server/routers/question-bank")).questionBankRouter,
    interviewForm: (await import("../src/server/routers/interviewForm")).interviewFormRouter,
    batchAccess: await import("../src/server/batch-access"),
    premade: await import("../src/lib/auto-include-premade"),
    inbound: await import("../src/app/api/webhooks/candidates/inbound"),
    reportTemplate: await import("../src/lib/report-template"),
  };
});

const caller = (router: any, db: ReturnType<typeof memDb>, user: string) => router.createCaller(ctxFor(db, user));

describe("SKILLMARK-ORGMEMBER-PROJECT-CROSS-TENANT-TAKEOVER", () => {
  it("rejects updateProjectRole on another org's project and writes nothing", async () => {
    const db = seed();
    await rejects(
      caller(m.orgMember, db, "attacker").updateProjectRole({ organizationId: ORG_A, projectId: P_B, userId: "attacker", role: "OWNER" }),
      "NOT_FOUND",
    );
    assert.equal(db.writes.filter((w) => w.table === "project_members").length, 0);
  });

  it("rejects listProjectRoles / removeProjectMember across orgs", async () => {
    const db = seed();
    await rejects(caller(m.orgMember, db, "attacker").listProjectRoles({ organizationId: ORG_A, projectId: P_B2 }), "NOT_FOUND");
    await rejects(
      caller(m.orgMember, db, "attacker").removeProjectMember({ organizationId: ORG_A, projectId: P_B2, userId: "victimOwner" }),
      "NOT_FOUND",
    );
    assert.ok(db.tables.project_members.some((r) => r.projectId === P_B2 && r.userId === "victimOwner"));
  });

  it("rejects non-member targets and admin edits of an owner's project role", async () => {
    const db = seed();
    await rejects(
      caller(m.orgMember, db, "victimOwner").updateProjectRole({ organizationId: ORG_B, projectId: P_B, userId: "attacker", role: "ADMIN" }),
      "NOT_FOUND",
    );
    await rejects(
      caller(m.orgMember, db, "victimAdmin").updateProjectRole({ organizationId: ORG_B, projectId: P_B2, userId: "victimOwner", role: "VIEWER" }),
      "FORBIDDEN",
    );
    assert.equal(db.tables.project_members.find((r) => r.userId === "victimOwner")?.role, "OWNER");
  });

  it("still lets an owner manage project roles in their own org", async () => {
    const db = seed();
    await caller(m.orgMember, db, "victimOwner").updateProjectRole({ organizationId: ORG_B, projectId: P_B, userId: "member2", role: "ADMIN" });
    assert.equal(db.tables.project_members.find((r) => r.projectId === P_B && r.userId === "member2")?.role, "ADMIN");
  });
});

describe("SKILLMARK-PROJECT-ACCESS-TENANT-BYPASS", () => {
  it("hasProjectAccess fails closed for non-members of the project's org", async () => {
    const db = seed();
    assert.equal(await m.trpc.hasProjectAccess(db, P_B, "attacker"), false);
    assert.equal(await m.trpc.hasProjectAccess(db, P_B, "member2"), true);
    assert.equal(await m.trpc.hasProjectAccess(db, id(999), "attacker"), false);
  });

  it("interview.list / stats / dashboardStats / question.listAll reject a foreign projectId", async () => {
    const db = seed();
    await rejects(caller(m.interview, db, "attacker").list({ projectId: P_B }), "FORBIDDEN");
    await rejects(caller(m.interview, db, "attacker").list({ organizationId: ORG_A, projectId: P_B }), "FORBIDDEN");
    const stats = await caller(m.interview, db, "attacker").stats({ projectId: P_B });
    assert.equal(stats.totalInterviews, 0);
    const dash = await caller(m.interview, db, "attacker").dashboardStats({ projectId: P_B });
    assert.equal(dash.totalInterviews, 0);
    const qs = await caller(m.question, db, "attacker").listAll({ projectId: P_B });
    assert.deepEqual(qs.questions, []);
  });

  it("members still see their own project", async () => {
    const db = seed();
    const res = await caller(m.interview, db, "member2").list({ projectId: P_B });
    assert.ok(res.interviews.length >= 2);
  });
});

describe("SKILLMARK-ORG-LIFECYCLE-GUARD-BYPASS", () => {
  it("getOrgMembership hides DELETED orgs and blocks writes on SUSPENDED", async () => {
    const db = seed();
    assert.equal(await m.trpc.getOrgMembership(db, ORG_D, "attacker"), null);
    const read = await m.trpc.getOrgMembership(db, ORG_S, "attacker");
    assert.equal(read?.role, "OWNER");
    await rejects(m.trpc.getOrgMembership(db, ORG_S, "attacker", { write: true }), "FORBIDDEN");
  });

  it("blocks writes on suspended orgs across routers but keeps reads", async () => {
    const db = seed();
    await rejects(caller(m.project, db, "attacker").create({ organizationId: ORG_S, name: "x" }), "FORBIDDEN");
    const list = await caller(m.project, db, "attacker").list({ organizationId: ORG_S });
    assert.equal(list.length, 1);
    await rejects(caller(m.interview, db, "attacker").update({ id: IV_S, title: "pwn" }), "FORBIDDEN");
    const got = await caller(m.interview, db, "attacker").getById({ id: IV_S });
    assert.equal(got.id, IV_S);
    await rejects(caller(m.orgMember, db, "attacker").updateRole({ organizationId: ORG_S, userId: "suspMember", role: "ADMIN" }), "FORBIDDEN");
    await rejects(caller(m.integration, db, "attacker").save({ organizationId: ORG_S, resendFrom: "x@y.z" }), "FORBIDDEN");
    await rejects(m.batchAccess.verifyProjectAccess(db, P_S, "attacker", { write: true }), "FORBIDDEN");
    assert.equal(db.tables.interviews.find((r) => r.id === IV_S)?.title, "Interview 24");
  });

  it("treats soft-deleted orgs as gone for reads and writes", async () => {
    const db = seed();
    await rejects(caller(m.project, db, "attacker").list({ organizationId: ORG_D }), "FORBIDDEN");
    await rejects(caller(m.organization, db, "attacker").getById({ id: ORG_D }), "NOT_FOUND");
    assert.deepEqual(await m.trpc.filterAccessibleProjectIds(db, [P_A, P_D], "attacker"), [P_A]);
  });
});

describe("SKILLMARK-PROJECT-GETBYID-ACL-BYPASS", () => {
  it("rejects org members excluded from a restricted project", async () => {
    const db = seed();
    await rejects(caller(m.project, db, "member2").getById({ id: P_B2 }), "FORBIDDEN");
    const ok = await caller(m.project, db, "victimOwner").getById({ id: P_B2 });
    assert.equal(ok.id, P_B2);
  });
});

describe("SKILLMARK-USAGE-PROJECT-IDOR", () => {
  it("ignores a projectId outside the authorized org", async () => {
    const db = seed();
    const sessions = await caller(m.usage, db, "attacker").sessionTransactions({ organizationId: ORG_A, projectId: P_B, period: "last30" });
    assert.deepEqual(sessions, []);
    const templates = await caller(m.usage, db, "attacker").templateTransactions({ organizationId: ORG_A, projectId: P_B, period: "last30" });
    assert.deepEqual(templates, []);
  });

  it("does not fall back to a deleted org or a restricted project", async () => {
    const db = seed();
    assert.deepEqual(await caller(m.usage, db, "deletedOnly").sessionTransactions({ period: "last30" }), []);
    const restricted = await caller(m.usage, db, "member2").templateTransactions({ organizationId: ORG_B, projectId: P_B2, period: "last30" });
    assert.deepEqual(restricted, []);
    const own = await caller(m.usage, db, "victimOwner").sessionTransactions({ organizationId: ORG_B, projectId: P_B, period: "last30" });
    assert.equal(own.length, 2);
  });
});

describe("SKILLMARK-ORG-REPORT-TEMPLATE-VIEWER-MUTATION", () => {
  it("rejects VIEWERs and suspended orgs", async () => {
    const db = seed();
    const template = m.reportTemplate.DEFAULT_REPORT_TEMPLATE;
    await rejects(caller(m.organization, db, "viewer").saveReportTemplate({ organizationId: ORG_B, template }), "FORBIDDEN");
    await rejects(caller(m.organization, db, "attacker").saveReportTemplate({ organizationId: ORG_S, template }), "FORBIDDEN");
    assert.equal(db.writes.filter((w) => w.table === "organizations").length, 0);
    await caller(m.organization, db, "member2").saveReportTemplate({ organizationId: ORG_B, template });
    assert.ok(db.tables.organizations.find((o) => o.id === ORG_B)?.reportTemplate);
  });
});

describe("SKILLMARK-ORG-PURGE-ORPHANED-INTERVIEWS", () => {
  it("project.delete removes the project's interviews instead of orphaning them", async () => {
    const db = seed();
    await caller(m.project, db, "victimOwner").delete({ id: P_B });
    assert.equal(db.tables.interviews.filter((r) => r.projectId === P_B).length, 0);
    assert.equal(db.tables.projects.some((p) => p.id === P_B), false);
  });
});

describe("SKILLMARK-INTEGRATION-INBOUND-SECRET-EXPOSURE", () => {
  it("returns the inbound secret only to admins", async () => {
    const db = seed();
    const asViewer = await caller(m.integration, db, "viewer").get({ organizationId: ORG_B });
    assert.equal(asViewer.inboundWebhook.secret, "");
    assert.equal(asViewer.inboundWebhook.configured, true);
    assert.ok(!JSON.stringify(asViewer).includes("whsec_supersecretvalue123"));
    const asMember = await caller(m.integration, db, "member2").get({ organizationId: ORG_B });
    assert.equal(asMember.inboundWebhook.secret, "");
    const asOwner = await caller(m.integration, db, "victimOwner").get({ organizationId: ORG_B });
    assert.equal(asOwner.inboundWebhook.secret, "whsec_supersecretvalue123");
  });
});

describe("SKILLMARK-NV-OUTBOUND-WEBHOOK-SSRF", () => {
  it("rejects private, non-https and query-bearing destinations on save", async () => {
    const db = seed();
    const c = caller(m.integration, db, "attacker");
    await rejects(c.save({ organizationId: ORG_A, outboundWebhookUrl: "https://127.0.0.1/hook" }), "BAD_REQUEST");
    await rejects(c.save({ organizationId: ORG_A, outboundWebhookUrl: "http://93.184.216.34/hook" }), "BAD_REQUEST");
    await rejects(c.save({ organizationId: ORG_A, outboundWebhookUrl: "https://[::ffff:10.0.0.1]/hook" }), "BAD_REQUEST");
    await rejects(c.save({ organizationId: ORG_A, resilioBaseUrl: "https://93.184.216.34/x?y=1" }), "BAD_REQUEST");
    await rejects(c.save({ organizationId: ORG_A, resilioBaseUrl: "https://172.18.0.1:3199" }), "BAD_REQUEST");
    assert.equal(db.writes.filter((w) => w.table === "org_integrations").length, 0);
    await c.save({ organizationId: ORG_A, outboundWebhookUrl: "https://93.184.216.34/hook" });
    assert.equal(db.tables.org_integrations.find((r) => r.organizationId === ORG_A)?.outboundWebhookUrl, "https://93.184.216.34/hook");
  });
});

describe("SKILLMARK-BATCH-UPLOAD-CV-VIEWER-BYPASS", () => {
  it("rejects VIEWERs, outsiders and suspended orgs", async () => {
    const db = seed();
    const auth = m.batchAccess.authorizeCandidateCvUpload;
    assert.deepEqual(await auth(db, CAND_B, "viewer"), { ok: false, status: 403, error: "Forbidden" });
    assert.equal((await auth(db, CAND_B, "attacker")).ok, false);
    assert.equal((await auth(db, CAND_S, "suspMember")).ok, false);
    assert.equal((await auth(db, id(999), "member2")).status, 404);
    const ok = await auth(db, CAND_B, "member2");
    assert.equal(ok.ok, true);
    assert.equal(ok.orgId, ORG_B);
  });
});

describe("SKILLMARK-INTERVIEWFORM-PROJECT-ACCESS-BYPASS", () => {
  it("hides restricted-project forms, applications and CVs from excluded members", async () => {
    const db = seed();
    const c = caller(m.interviewForm, db, "member2");
    await rejects(c.get({ id: FORM_R }), "FORBIDDEN");
    await rejects(c.update({ id: FORM_R, name: "pwn" }), "FORBIDDEN");
    await rejects(c.projectInterviews({ id: FORM_R }), "FORBIDDEN");
    await rejects(c.cvLink({ applicationId: APP_R }), "FORBIDDEN");
    await rejects(c.create({ organizationId: ORG_B, projectId: P_B2, name: "x" }), "FORBIDDEN");
    const list = await c.list({ organizationId: ORG_B });
    assert.equal(list.length, 0);
    const ownerList = await caller(m.interviewForm, db, "victimOwner").list({ organizationId: ORG_B });
    assert.equal(ownerList.length, 1);
  });
});

describe("SKILLMARK-QUESTIONBANK-CROSS-ORG-SECTION-INJECTION", () => {
  it("rejects sectionIds from another org on createItem / updateItem", async () => {
    const db = seed();
    const c = caller(m.questionBank, db, "attacker");
    await rejects(c.createItem({ organizationId: ORG_A, sectionId: SEC_B, text: "inject" }), "BAD_REQUEST");
    await rejects(c.updateItem({ id: ITEM_A, sectionId: SEC_B }), "BAD_REQUEST");
    assert.equal(db.tables.question_bank_items.find((r) => r.id === ITEM_A)?.sectionId, SEC_A);
    assert.equal(db.writes.filter((w) => w.table === "question_bank_items").length, 0);
  });

  it("does not surface foreign-org items placed in a victim section", async () => {
    const db = seed();
    const enabled = await caller(m.questionBank, db, "member2").getEnabledQuestions({ organizationId: ORG_B });
    assert.deepEqual(enabled.questions.map((q: any) => q.text), ["legit B item"]);
    const auto = await m.premade.loadAutoIncludePremade(db, ORG_B);
    assert.deepEqual(auto.map((q: any) => q.text), ["legit B item"]);
  });
});

describe("SKILLMARK-QUESTION-REORDER-UNSCOPED-UPDATE", () => {
  it("only reorders questions of the authorized interview", async () => {
    const db = seed();
    await caller(m.question, db, "attacker").reorder({ interviewId: IV_A, questionIds: [Q_B] });
    assert.equal(db.tables.questions.find((q) => q.id === Q_B)?.order, 7);
  });
});

describe("SKILLMARK-INTERVIEW-DELETEMANY-SESSION-GUARD-BYPASS", () => {
  it("blocks MEMBER bulk-deleting an interview with completed sessions", async () => {
    const db = seed();
    await rejects(caller(m.interview, db, "member2").deleteMany({ ids: [IV_B2] }), "FORBIDDEN");
    assert.ok(db.tables.interviews.some((r) => r.id === IV_B2));
  });
});

describe("SKILLMARK-INTERVIEW-UNPUBLISH-CREATOR-BYPASS", () => {
  it("blocks MEMBERs from (un)publishing a teammate's interview", async () => {
    const db = seed();
    await rejects(caller(m.interview, db, "member2").unpublish({ id: IV_B }), "FORBIDDEN");
    await rejects(caller(m.interview, db, "member2").publish({ id: IV_B }), "FORBIDDEN");
    assert.equal(db.tables.interviews.find((r) => r.id === IV_B)?.isActive, true);
    await caller(m.interview, db, "member2").unpublish({ id: IV_B2 });
    assert.equal(db.tables.interviews.find((r) => r.id === IV_B2)?.isActive, false);
  });
});

describe("SKILLMARK-APIKEY-MISSING-ROLE-AND-ORG-STATUS-BINDING (filterAccessibleProjectIds)", () => {
  it("honours minRole using the effective org/project role", async () => {
    const db = seed();
    const f = m.trpc.filterAccessibleProjectIds;
    assert.deepEqual(await f(db, [P_B], "viewer"), [P_B]);
    assert.deepEqual(await f(db, [P_B], "viewer", { minRole: "MEMBER" }), []);
    db.tables.project_members.push({ projectId: P_B2, userId: "viewer", role: "MEMBER" });
    assert.deepEqual(await f(db, [P_B, P_B2], "viewer", { minRole: "MEMBER" }), [P_B2]);
    assert.deepEqual(await f(db, [P_B], "attacker"), []);
  });
});

describe("SKILLMARK-VULN-IDOR-INBOUND-WEBHOOK", () => {
  it("rejects a foreign batchId alongside an owned interviewId", async () => {
    const db = seed();
    const r = await m.inbound.resolveInboundTarget(db, ORG_A, { interviewId: IV_A, batchId: BATCH_B });
    assert.deepEqual(r, { ok: false, status: 403, error: "Batch not found or does not belong to your organization" });
  });

  it("rejects a batch that differs from the interview's own batch, accepts consistent selectors", async () => {
    const db = seed();
    db.tables.interviews.find((r) => r.id === IV_A)!.batchId = BATCH_A;
    const mismatch = await m.inbound.resolveInboundTarget(db, ORG_A, { interviewId: IV_A, batchId: BATCH_A2 });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.status, 400);
    const ok = await m.inbound.resolveInboundTarget(db, ORG_A, { interviewId: IV_A });
    assert.deepEqual(ok, { ok: true, interviewId: IV_A, batchId: BATCH_A });
  });
});

describe("SKILLMARK-WEBHOOK-INBOUND-IGNORES-ORG-STATUS", () => {
  it("only ACTIVE orgs accept inbound candidates", async () => {
    const db = seed();
    assert.equal(await m.inbound.orgAcceptsInbound(db, ORG_A), true);
    assert.equal(await m.inbound.orgAcceptsInbound(db, ORG_S), false);
    assert.equal(await m.inbound.orgAcceptsInbound(db, ORG_D), false);
    assert.equal(await m.inbound.orgAcceptsInbound(db, id(999)), false);
  });
});
