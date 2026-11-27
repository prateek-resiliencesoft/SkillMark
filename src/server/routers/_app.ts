import { router } from "../trpc";
import { interviewRouter } from "./interview";
import { questionRouter } from "./question";
import { sessionRouter } from "./session";
import { codeRouter } from "./code";
import { analysisRouter } from "./analysis";
import { organizationRouter } from "./organization";
import { orgMemberRouter } from "./orgMember";
import { projectRouter } from "./project";
import { authRouter } from "./auth";
import { apiKeyRouter } from "./apikey";
import { userRouter } from "./user";
import { webhookRouter } from "./webhook";
import { candidateRouter } from "./candidate";
import { usageRouter } from "./usage";
import { questionBankRouter } from "./question-bank";
import { batchRouter } from "./batch";
import { integrationRouter } from "./integration";
import { interviewFormRouter } from "./interviewForm";
import { aiSettingsRouter } from "./aiSettings";
import { aiPresetsRouter } from "./aiPresets";
import { platformRouter } from "./platform";
import { platformOpsRouter } from "./platform-ops";
import { errorLogsRouter } from "./error-logs";
import { bugTriageRouter } from "./bug-triage";
import { billingRouter } from "./billing";
import { statusRouter } from "./status";
import { aiRunsRouter } from "./aiRuns";
import { roundTwoRouter } from "./roundTwo";
import { landingRouter } from "@landing/server/router";

export const appRouter = router({
  auth: authRouter,
  interview: interviewRouter,
  question: questionRouter,
  questionBank: questionBankRouter,
  session: sessionRouter,
  code: codeRouter,
  analysis: analysisRouter,
  organization: organizationRouter,
  orgMember: orgMemberRouter,
  project: projectRouter,
  apiKey: apiKeyRouter,
  webhook: webhookRouter,
  user: userRouter,
  candidate: candidateRouter,
  usage: usageRouter,
  batch: batchRouter,
  integration: integrationRouter,
  interviewForm: interviewFormRouter,
  aiSettings: aiSettingsRouter,
  aiPresets: aiPresetsRouter,
  platform: platformRouter,
  platformOps: platformOpsRouter,
  errorLogs: errorLogsRouter,
  bugTriage: bugTriageRouter,
  billing: billingRouter,
  status: statusRouter,
  roundTwo: roundTwoRouter,
  aiRuns: aiRunsRouter,
  landing: landingRouter,
});

export type AppRouter = typeof appRouter;
