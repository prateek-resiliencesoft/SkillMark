# Graph Report - SkillMark  (2026-11-17)

## Corpus Check
- 631 files · ~461,804 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 26 file(s) not represented in the graph (top: (none) 8, .woff2 6, .css 3)

## Summary
- 4439 nodes · 14573 edges · 181 communities (164 shown, 17 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 50 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b881bfab`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- candidate-manager.tsx
- react
- Skeleton
- Button
- docs/index.ts
- ai-generator.tsx
- logger.ts
- cn
- next
- applications.ts
- batch.ts
- dependencies
- platform-ops.ts
- session-report-view.tsx
- admin.ts
- package.json
- _app.ts
- use-voice.ts
- session-report-server.ts
- interviewee-onboarding.tsx
- credentials.ts
- with
- ai/types.ts
- code-editor-canvas.tsx
- config/page.tsx
- gemini-voice-relay.ts
- api-reference.tsx
- relay-routing.ts
- save/route.ts
- liquid-glass-logo-reveal.tsx
- preflight.ts
- connect/page.tsx
- recording-parts-server.ts
- storage.ts
- pie-chart.tsx
- openai-voice-relay.ts
- db
- env
- voice-relay.ts
- extract.ts
- head-movement-guard.tsx
- ref_node_assert
- uptime/client.ts
- [token]/session/page.tsx
- sparkline.tsx
- endpoints.ts
- head-movement.ts
- tour-provider.tsx
- billing.ts
- cv-profile.ts
- retranscribe.ts
- service.ts
- steps
- providers.tsx
- handleInterview
- handleBrowserConnection
- gauge.tsx
- candidate.ts
- i18n.ts
- handler.ts
- registry.ts
- session-error-log.ts
- platform.ts
- VadFailsafe
- tenant.ts
- capture-readme-screenshots.mjs
- handleInterview
- session.ts
- gauge-label-layout.tsx
- patterns/index.ts
- parameters
- motion
- volcengine-protocol.ts
- (dashboard)/integrations/page.tsx
- dev-waker.py
- settings/ai/page.tsx
- particle-text.tsx
- align.ts
- public-api.test.ts
- interview-language.ts
- orgMember.ts
- compilerOptions
- scripts
- volcengine-asr.ts
- use-interview-recording.ts
- form.tsx
- session-link-server.ts
- openapi.ts
- resume-parse.ts
- transcript-dedupe.test.ts
- with
- toast.tsx
- ServerEvent
- (dashboard)/status/page.tsx
- dithered-logo.tsx
- analysis.ts
- SilenceCheck
- steps
- preflight-server.ts
- usage/page.tsx
- interviewee-tour-provider.tsx
- sparkline-geometry.ts
- components.json
- db
- source-must-be-dev
- command.tsx
- theme-transition.tsx
- interviewee-guide-content.tsx
- interviewForm.ts
- endpointing.ts
- rest
- db
- animation.ts
- deploy.yml
- functional.test.ts
- bestAvailableTranscript
- handleWhisperCompletedTranscript
- ui/not-found.tsx
- FailoverProvider
- question-conditions.ts
- voice-functional-harness.tsx
- LineOrAreaPaths
- interviewer-persona.ts
- app
- voice
- interviewer.ts
- app
- rules
- steps
- repository
- network-security.ts
- voice-relay-helpers.ts
- chat/route.ts
- services
- caddy
- webhooks.ts
- token/route.ts
- chart-defs.ts
- supabase/client.ts
- options
- services
- rest
- whiteboard-canvas.tsx
- generate-mic-test-audio.mjs
- context.ts
- chart-parent-size.tsx
- depends_on
- environment
- healthcheck
- environment
- environment
- environment
- environment
- tailwindcss
- voice-entrypoint.sh
- normalizeTranscript
- LineOrArea
- HoverMarksView
- interview-templates.ts
- session-score.ts
- time-range.ts
- volumes
- on
- onnxruntime-web
- static-chart-preview-context.tsx
- analytics.ts
- postcss.config.mjs
- db-migrate.sh
- retranscribe-session.mjs
- css.d.ts
- htmlparser2
- apply-main-ruleset.sh
- keep-caddy-dev.sh
- mediapipe-assets.sh
- prune-deploy-images.sh
- vad-assets.sh
- write-deploy-env.sh
- voice/types.ts

## God Nodes (most connected - your core abstractions)
1. `cn()` - 328 edges
2. `react` - 188 edges
3. `Button` - 160 edges
4. `next` - 124 edges
5. `Input` - 122 edges
6. `useToast()` - 116 edges
7. `lucide-react` - 116 edges
8. `Skeleton()` - 112 edges
9. `Card` - 112 edges
10. `CardContent` - 112 edges

## Surprising Connections (you probably didn't know these)
- `buildSystemPrompt()` --calls--> `interviewerPromptIdentity()`  [EXTRACTED]
  server/gemini-voice-relay.ts → src/lib/interviewer-persona.ts
- `buildSystemPrompt()` --calls--> `interviewerPromptIdentity()`  [EXTRACTED]
  server/openai-voice-relay.ts → src/lib/interviewer-persona.ts
- `connectGeminiWithKey()` --calls--> `resolveGeminiVoice()`  [EXTRACTED]
  server/gemini-voice-relay.ts → src/lib/interviewer-persona.ts
- `buildSystemPrompt()` --calls--> `buildCandidateFocusSection()`  [EXTRACTED]
  server/gemini-voice-relay.ts → src/lib/ai/prompts/candidate-focus.ts
- `handleInterview()` --calls--> `nextAskableQuestionIndex()`  [EXTRACTED]
  server/gemini-voice-relay.ts → src/lib/question-conditions.ts

## Import Cycles
- 2-file cycle: `src/lib/supabase/admin.ts -> src/lib/users.ts -> src/lib/supabase/admin.ts`

## Communities (181 total, 17 thin omitted)

### Community 0 - "candidate-manager.tsx"
Cohesion: 0.04
Nodes (165): CandidateRow, CandidatesPage(), getCellValue(), ColumnDef, COLUMNS, DEFAULT_VISIBLE, formatDate(), formatDuration() (+157 more)

### Community 1 - "react"
Cohesion: 0.06
Nodes (87): lucide-react, react, LoginPage(), RegisterPage(), AccountPage(), BatchesPage(), Stat(), DashboardPage() (+79 more)

### Community 2 - "Skeleton"
Cohesion: 0.05
Nodes (87): AdminActivityPage(), metaBits(), AdminOrgAiPage(), ProviderId, AdminOrgIntegrationsPage(), AdminOrganizationDetailPage(), limitInputValue(), MEMBER_ROLES (+79 more)

### Community 3 - "Button"
Cohesion: 0.07
Nodes (89): DEFAULT_SCOPES, DevelopersPage(), OTHER_SCOPES, RESULT_SCOPES, Tab, TABS, when(), EditInterviewContext (+81 more)

### Community 4 - "docs/index.ts"
Cohesion: 0.06
Nodes (62): AdminLayout(), CategoryLayout(), CategoryPage(), generateMetadata(), ArticlePage(), generateMetadata(), generateStaticParams(), DocsHomePage() (+54 more)

### Community 5 - "ai-generator.tsx"
Cohesion: 0.08
Nodes (70): BatchDetailPage(), Filter, InviteState(), isInviteExpired(), Status, STATUS_META, InterviewFormBuilderPage(), normalizeInterviewLanguage() (+62 more)

### Community 6 - "logger.ts"
Cohesion: 0.05
Nodes (66): htmlToText(), log, pdfParse, POST(), STRIPPED_TAGS, truncate(), log, POST() (+58 more)

### Community 7 - "cn"
Cohesion: 0.06
Nodes (52): InterviewFormIntegrationLayout(), tabs, DataTableWrapper(), TableRow(), Account, AccountSwitcher(), loginUrl(), Header() (+44 more)

### Community 8 - "next"
Cohesion: 0.08
Nodes (53): jose, next, dynamic, GET(), POST(), POST(), POST(), POST() (+45 more)

### Community 9 - "applications.ts"
Cohesion: 0.06
Nodes (66): authRequest(), CORS, DELETE, dynamic, GET, handle(), POST, runtime (+58 more)

### Community 10 - "batch.ts"
Cohesion: 0.08
Nodes (63): server-only, inboundCandidateSchema, POST(), completionNotifyMembersSchema, profileToResumeText(), RESILIO_DEFAULT_BASE_URL, sendBrevoEmail(), sendResendEmail() (+55 more)

### Community 11 - "dependencies"
Cohesion: 0.03
Nodes (73): dependencies, aws4fetch@^1.0.20, bcryptjs@^2.4.3, bufferutil@^4.1.0, clsx@^2.1.1, domutils@^3.2.2, dotenv@^17.3.1, fix-webm-duration@^1.0.6 (+65 more)

### Community 12 - "platform-ops.ts"
Cohesion: 0.06
Nodes (61): AdminServerActivityPage(), last(), MetricChart(), pct(), peak(), rate(), timeLabel(), clampSeconds() (+53 more)

### Community 13 - "session-report-view.tsx"
Cohesion: 0.07
Nodes (51): MM_TO_PX, REC_COLOR, REC_TEXT, ReportDocumentProps, CountUp(), ExpandableText(), REC, RecommendationBadge() (+43 more)

### Community 14 - "admin.ts"
Cohesion: 0.10
Nodes (46): CandidateInput, GET(), normalizeCandidateInput(), POST(), POST(), GET(), interviewAccessError(), normalizeOne() (+38 more)

### Community 15 - "package.json"
Cohesion: 0.04
Nodes (56): author, bugs, url, canvas-confetti@^1.9.4, html2canvas-pro@^1.6.7, @hugeicons/core-free-icons@^4.3.5, @modelcontextprotocol/sdk@^1.32.2, pdf-parse@^1.1.1 (+48 more)

### Community 16 - "_app.ts"
Cohesion: 0.11
Nodes (44): @trpc/server, zod, questionSkipIfSchema, normalizeReportTemplate(), Db, DeletedKey, deleteOrgApiKey(), apiKeyRouter (+36 more)

### Community 17 - "use-voice.ts"
Cohesion: 0.07
Nodes (41): float32ToPcmHex(), log, TrackedMessage, useVoice(), UseVoiceOptions, VoiceState, JITTER_BUFFER_ADAPTIVE_MAX_MS, JITTER_BUFFER_LOW_WATER_MS (+33 more)

### Community 18 - "session-report-server.ts"
Cohesion: 0.08
Nodes (45): VoiceSaveOps, g, log, startReportSweeper(), ContentStats, contentStats(), decideReport(), EMPTY_SESSION_IDLE_MS (+37 more)

### Community 19 - "interviewee-onboarding.tsx"
Cohesion: 0.08
Nodes (43): CodeBlock(), CodeBlockProps, LANG_MAP, toPrismLang(), CodeEditorCanvas, CodeEditorCanvasRef, ChatInterface(), getAIResponse() (+35 more)

### Community 20 - "credentials.ts"
Cohesion: 0.09
Nodes (46): checkVoiceModel(), isVoiceCapableProvider(), PROVIDER_CAPS, ProviderCapId, ProviderCaps, TEXT_ONLY, VOICE_OK, VOICE_PROVIDER_IDS (+38 more)

### Community 21 - "with"
Cohesion: 0.04
Nodes (47): concurrency, cancel-in-progress, group, name, runs-on, steps, env, APP_IMAGE (+39 more)

### Community 22 - "ai/types.ts"
Cohesion: 0.10
Nodes (20): openai@^6.22.0, openai, AnthropicContent, AnthropicProvider, splitMessages(), CompatibleOpenAIProvider, CompatibleProviderOptions, enrichOpenAIError() (+12 more)

### Community 23 - "code-editor-canvas.tsx"
Cohesion: 0.08
Nodes (30): CodeEditorCanvasProps, CodeRunOutput, EditorState, parseState(), runCodeRequest(), Starter, SUPPORTED_LANGUAGES, ALIASES (+22 more)

### Community 24 - "config/page.tsx"
Cohesion: 0.10
Nodes (40): AdminConfigPage(), fromDraft(), limitField(), parseLimit(), PlanDraft, toDraft(), DEFAULT_PLAN_CATALOG, DEFAULT_PLAN_FEATURES (+32 more)

### Community 25 - "gemini-voice-relay.ts"
Cohesion: 0.07
Nodes (37): CODING_DONE_PATTERNS, connectGemini(), connectGeminiWithKey(), FAST_NEXT_PATTERNS, FAST_PREV_PATTERNS, GEMINI_TOOLS, GeminiConnectOpts, GeminiMsg (+29 more)

### Community 26 - "api-reference.tsx"
Cohesion: 0.10
Nodes (38): ApiDocsPage(), ApiReference(), CodeBlock(), CopyButton(), IdPicker(), Lang, loadPicks(), METHOD_BADGE (+30 more)

### Community 27 - "relay-routing.ts"
Cohesion: 0.07
Nodes (21): buildRelayTargets(), deriveSiblingRelayUrl(), deriveUrlFromBrowser(), isLocalBrowserHost(), normalizeBinaryData(), RelayConnectedContext, RelayConnector, RelayConnectorOptions (+13 more)

### Community 28 - "save/route.ts"
Cohesion: 0.11
Nodes (31): GET(), POST(), runtime, submitLimited(), submits, POST(), log, POST() (+23 more)

### Community 29 - "liquid-glass-logo-reveal.tsx"
Cohesion: 0.09
Nodes (36): buildSdf(), clamp01(), createRenderer(), edt(), edt1d(), endOf(), fitToTexture(), Frame (+28 more)

### Community 30 - "preflight.ts"
Cohesion: 0.10
Nodes (30): fmtTime(), PreflightProgress(), statusText(), PreflightContext, PreflightProvider(), ReportFn, buildPreflightTimeline(), collectDeviceInfo() (+22 more)

### Community 31 - "connect/page.tsx"
Cohesion: 0.15
Nodes (32): CodeTab(), FormPicker(), McpTab(), MyIntegrationsInner(), MyIntegrationsPage(), Step(), PublicForm, CodeBlock() (+24 more)

### Community 32 - "recording-parts-server.ts"
Cohesion: 0.12
Nodes (27): log, POST(), groupRecordingParts(), isRunComplete(), mimeForRecordingExt(), parseRecordingPartKey(), RECORDING_PART_EXTS, recordingExtForMime() (+19 more)

### Community 33 - "storage.ts"
Cohesion: 0.13
Nodes (29): nextConfig, GET(), clearStoredMedia(), copyStoredObject(), deletePrefix(), Err, getStorageConfigSummary(), isObjectStorageEnabled() (+21 more)

### Community 34 - "pie-chart.tsx"
Cohesion: 0.11
Nodes (28): d3-shape@^3.2.0, @visx/shape@^4.0.0, d3-shape, @visx/shape, ParentSize(), PieCenter(), PieCenterShell(), PieCenterShellProps (+20 more)

### Community 35 - "openai-voice-relay.ts"
Cohesion: 0.08
Nodes (29): ASR_PRIMARY, AZURE_VOICE, buildSystemPrompt(), CODING_DONE_PATTERNS, FAST_NEXT_PATTERNS, FAST_PREV_PATTERNS, handleCommittedUserText(), tryHandleExplicitUserNavigation() (+21 more)

### Community 36 - "db"
Cohesion: 0.06
Nodes (30): condition, environment, healthcheck, image, ports, restart, volumes, db (+22 more)

### Community 37 - "env"
Cohesion: 0.06
Nodes (31): AUTH_SECRET, AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, CODE_RUNNER_API_KEY, CRON_SECRET, DOUBAO_ACCESS_TOKEN, DOUBAO_APP_ID, GEMINI_API_KEY (+23 more)

### Community 38 - "voice-relay.ts"
Cohesion: 0.08
Nodes (29): ws@^8.19.0, ws, AgentContext, callLLM(), CORRECTION_PATTERNS_EN, CORRECTION_PATTERNS_ZH, describeWhiteboard(), extractText() (+21 more)

### Community 39 - "extract.ts"
Cohesion: 0.12
Nodes (28): log, maxDuration, POST(), loadOrgAiCredentials(), countPages(), detectKind(), DocKind, extractDocument() (+20 more)

### Community 40 - "head-movement-guard.tsx"
Cohesion: 0.13
Nodes (23): AntiCheatingGuard(), AntiCheatingGuardProps, ModalState, HeadMovementGuard(), ModalState, Props, AntiCheatingViolation, useAntiCheating() (+15 more)

### Community 41 - "ref_node_assert"
Cohesion: 0.12
Nodes (4): DEFAULT_QUESTION_BANK_SECTIONS, FILES, ROOT, relayPath

### Community 42 - "uptime/client.ts"
Cohesion: 0.11
Nodes (26): clientIp(), CORS, dynamic, GET(), runtime, cfg(), CreateMonitorInput, CreateMonitorResult (+18 more)

### Community 43 - "[token]/session/page.tsx"
Cohesion: 0.18
Nodes (22): InvitePage(), SessionLoading(), ChatInterface, InviteSessionPage(), VoiceInterface, SessionLoading(), ChatInterface, SlugSessionPage() (+14 more)

### Community 44 - "sparkline.tsx"
Cohesion: 0.10
Nodes (27): chartCssVars, defaultScatterColors, AnimatedNumber, AreaSparklineProps, BarSparklineProps, DATA_TRANSITION_EASE, DEFAULT_SPARKLINE_ANIMATION_DURATION_MS, DEFAULT_SPARKLINE_DATA_TRANSITION_MS (+19 more)

### Community 45 - "endpoints.ts"
Cohesion: 0.10
Nodes (26): API_KEY_SCOPE_LABELS, API_KEY_SCOPES, ApiKeyEnvironment, ApiKeyScope, LEGACY_READ_IMPLIES, exampleSession, Candidate, CreateInviteBody (+18 more)

### Community 46 - "head-movement.ts"
Cohesion: 0.13
Nodes (18): @mediapipe/tasks-vision@^1.2.0, @mediapipe/tasks-vision, exists(), Options, useHeadMovementDetection(), suppressDetections(), classifyFrame(), countHeadViolations() (+10 more)

### Community 47 - "tour-provider.tsx"
Cohesion: 0.12
Nodes (22): react-dom@^18, react-dom, BRAND_COLORS, fireConfetti(), TourCelebration(), getStepNavUrl(), TourChecklist(), TourChecklistProps (+14 more)

### Community 48 - "billing.ts"
Cohesion: 0.16
Nodes (22): applySubscription(), dynamic, findOrgIdByCustomer(), log, POST(), runtime, formatLimit(), OrgPlanId (+14 more)

### Community 49 - "cv-profile.ts"
Cohesion: 0.12
Nodes (23): CvRow, closeTruncatedJson(), extractBalancedObject(), extractJson(), log, sanitiseJsonString(), stripTrailingCommas(), resolveFallbackProviders() (+15 more)

### Community 50 - "retranscribe.ts"
Cohesion: 0.13
Nodes (23): dynamic, hasInternalSecret(), log, maxDuration, POST(), storage, buildPrompt(), callGemini() (+15 more)

### Community 51 - "service.ts"
Cohesion: 0.20
Nodes (24): runEndpoint(), ApiAuth, ApiDb, ApiProblem, CANDIDATE_STATUS, candidateFor(), createInvite(), decodeCursor() (+16 more)

### Community 52 - "steps"
Cohesion: 0.08
Nodes (24): name, runs-on, steps, concurrency, cancel-in-progress, group, AUTH_SECRET, NEXT_PUBLIC_APP_URL (+16 more)

### Community 53 - "providers.tsx"
Cohesion: 0.11
Nodes (22): superjson@^2.2.6, @tanstack/react-query@^4.43.0, @trpc/client@^10.45.4, superjson, @tanstack/react-query, @trpc/client, ibmPlexSansCondensed, inter (+14 more)

### Community 54 - "handleInterview"
Cohesion: 0.23
Nodes (25): buildSystemPrompt(), handleInterview(), armResponseWatchdog(), attach(), beginEnding(), checkStuckClientTurn(), clearResponseWatchdog(), endModelTurn() (+17 more)

### Community 55 - "handleBrowserConnection"
Cohesion: 0.20
Nodes (24): buildChoiceSuffix(), buildFarewellSayHello(), buildGreeting(), buildResumeGreeting(), buildReturnSayHello(), buildSystemText(), buildTransitionSayHello(), buildTTSOptions() (+16 more)

### Community 56 - "gauge.tsx"
Cohesion: 0.18
Nodes (23): DEFAULT_NOTCH_ENTER_TRANSITION, Gauge(), GaugeArcInner(), GaugeInner(), GaugeInnerProps, GaugeLinearInner(), GaugeNotchSvg(), GaugeOrientation (+15 more)

### Community 57 - "candidate.ts"
Cohesion: 0.16
Nodes (21): nanoid(), listPreflightEventsWithStatus(), expireIfStale(), expireNestedSession(), expireSessionsIfStale(), Db, fallbackQuestions(), generateTailoredQuestions() (+13 more)

### Community 58 - "i18n.ts"
Cohesion: 0.13
Nodes (22): PROMPTS, ResponsePromptParams, SPOKEN, AI_TONE_ZH, AI_TONE_ZH_DEFAULT, BiText, getLanguageKey(), getMicTestMessage() (+14 more)

### Community 59 - "handler.ts"
Cohesion: 0.12
Nodes (18): dynamic, GET, dynamic, POST, dynamic, GET, dynamic, GET (+10 more)

### Community 60 - "registry.ts"
Cohesion: 0.14
Nodes (23): AiTaskKind, ResolvedAiCredentials, routingForTask(), buildFromCreds(), ChainEntry, customModels(), geminiModels(), GENERATOR_MODEL (+15 more)

### Community 61 - "session-error-log.ts"
Cohesion: 0.17
Nodes (20): CATEGORY_LABELS, createClientErrorLimiter(), entryFromError(), ERROR_CATEGORIES, ERROR_SEVERITIES, ErrorCategory, errorLogToCsv(), ErrorSeverity (+12 more)

### Community 62 - "platform.ts"
Cohesion: 0.14
Nodes (22): authDb, defaultUptimeVisibility(), loadUptimeVisibility(), parseUptimeVisibility(), saveUptimeVisibility(), seedUptimeVisibilityIfNeeded(), UptimeVisibility, setUserPaused() (+14 more)

### Community 63 - "VadFailsafe"
Cohesion: 0.11
Nodes (6): FailsafeReason, MicChunk, QuestionReport, VAD_FAILSAFE_CONFIG, VadFailsafe, feed()

### Community 64 - "tenant.ts"
Cohesion: 0.13
Nodes (21): countOrgSeats(), filterInput, getInterviewIds(), getProjectIds(), Period, periodEnum, resolveCalendarPeriod(), resolveOrgId() (+13 more)

### Community 65 - "capture-readme-screenshots.mjs"
Cohesion: 0.10
Nodes (13): playwright@^1.58.2, playwright, __dirname, docs, marketing, root, shot(), shots (+5 more)

### Community 66 - "handleInterview"
Cohesion: 0.19
Nodes (23): handleInterview(), attachOaiHandlers(), buildRealtimeAudioInputConfig(), cleanupVolcAsr(), clearPendingTransition(), clearQuestionPrompt(), connectOai(), disableTools() (+15 more)

### Community 67 - "session.ts"
Cohesion: 0.17
Nodes (18): GET(), log, POST(), applyAntiCheatingViolation(), countStrikes(), applyMediaReview(), archiveSessionData(), clearSessionMediaStorage() (+10 more)

### Community 68 - "gauge-label-layout.tsx"
Cohesion: 0.17
Nodes (18): chartCenterContainerClassName, chartCenterLabelClassName, chartCenterValueClassName, ChartStatFlow(), ChartStatFlowFormat, ChartStatFlowProps, defaultChartStatFlowFormat, formatStatValue() (+10 more)

### Community 69 - "patterns/index.ts"
Cohesion: 0.22
Nodes (15): Circles(), PatternCirclesProps, PatternOrientation, PatternOrientationType, Hexagons(), PatternHexagonsProps, Lines(), pathForOrientation() (+7 more)

### Community 70 - "parameters"
Cohesion: 0.09
Nodes (21): bypass_actors, conditions, ref_name, enforcement, name, allowed_merge_methods, dismiss_stale_reviews_on_push, do_not_enforce_on_create (+13 more)

### Community 71 - "motion"
Cohesion: 0.18
Nodes (15): motion, usePie(), usePieHover(), usePieStable(), AnimatedSliceGrow(), AnimatedSliceGrowProps, AnimatedSliceTranslate(), AnimatedSliceTranslateProps (+7 more)

### Community 72 - "volcengine-protocol.ts"
Cohesion: 0.20
Nodes (19): handleMicTestConnection(), cleanup(), buildFinishConnection(), buildFinishSession(), buildSendAudio(), buildStartConnection(), buildStartSession(), CLIENT_AUDIO_ONLY_REQUEST (+11 more)

### Community 73 - "(dashboard)/integrations/page.tsx"
Cohesion: 0.15
Nodes (21): BrevoLogo(), CategoryRail(), EmailPane, Field(), generateRandomSecret(), IntegrationsSettingsPage(), OUTBOUND_EVENT_OPTIONS, ProviderTile() (+13 more)

### Community 74 - "dev-waker.py"
Cohesion: 0.20
Nodes (13): backend_ready(), ensure(), handle(), idle_loop(), listen_hosts(), log(), main(), mem_available_mb() (+5 more)

### Community 75 - "settings/ai/page.tsx"
Cohesion: 0.11
Nodes (19): AnthropicLogo(), CustomLlmLogo(), emptySlots(), GeminiLogo(), KeySlot, newSlot(), NvidiaLogo(), OpenAiLogo() (+11 more)

### Community 76 - "particle-text.tsx"
Cohesion: 0.13
Nodes (18): clamp(), easeInFall(), easeInOutCubic(), easeOutCubic(), FADE_FLOOR, fadeAlpha(), Particle, ParticleText() (+10 more)

### Community 77 - "align.ts"
Cohesion: 0.19
Nodes (18): alignCandidateTurns(), AlignedTurn, AnchorMessage, bigrams(), buildEchoIndex(), EchoIndex, echoScore(), isInterviewerEcho() (+10 more)

### Community 78 - "public-api.test.ts"
Cohesion: 0.16
Nodes (15): MCP_KEY_PLACEHOLDER, mcpConfigs(), ACCEPTED_PREFIXES, API_KEY_PREFIX, generateApiKey(), hashApiKey(), looksLikeApiKey(), parseBearerKey() (+7 more)

### Community 79 - "interview-language.ts"
Cohesion: 0.16
Nodes (17): buildInterviewerPrompt(), getInterviewLanguageDisplayName(), getInterviewLanguageStyle(), INTERVIEW_GEMINI_LANGUAGE_CODE, INTERVIEW_LANGUAGE_CODES, INTERVIEW_LANGUAGE_DISPLAY, INTERVIEW_LANGUAGE_STYLE, INTERVIEW_SPEECH_LOCALE (+9 more)

### Community 80 - "orgMember.ts"
Cohesion: 0.17
Nodes (18): acceptOrgInviteForUser(), AcceptOrgInviteResult, ensureProjectMembersPopulated(), normalizeEmail(), Supabase, assertQuota(), countOrgInterviews(), countOrgProjects() (+10 more)

### Community 81 - "compilerOptions"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 82 - "scripts"
Cohesion: 0.11
Nodes (19): scripts, build, db:down, db:dump, db:migrate, db:psql, db:restore, db:up (+11 more)

### Community 83 - "volcengine-asr.ts"
Cohesion: 0.18
Nodes (16): connectVolcAsr(), reconnectVolcAsr(), sendAudioToVolc(), handleMicTest(), cleanup(), connectMicTestVolcAsr(), resample16to24(), AsrResponse (+8 more)

### Community 84 - "use-interview-recording.ts"
Cohesion: 0.19
Nodes (17): log, PendingPart, resolveBlobDuration(), cleanup(), finish(), ScreenshotEntry, useInterviewRecording(), UseInterviewRecordingOptions (+9 more)

### Community 85 - "form.tsx"
Cohesion: 0.14
Nodes (16): @radix-ui/react-label@^2.1.8, @radix-ui/react-slot@^1.2.4, react-hook-form@^7.71.1, @radix-ui/react-label, @radix-ui/react-slot, react-hook-form, FormControl, FormDescription (+8 more)

### Community 86 - "session-link-server.ts"
Cohesion: 0.22
Nodes (12): POST(), isPreflightStale(), preflightLastActivityAt(), reachedClosing(), EndReason, HEARTBEAT_GRACE_MS, HEARTBEAT_INTERVAL_MS, isHeartbeatStale() (+4 more)

### Community 87 - "openapi.ts"
Cohesion: 0.19
Nodes (13): dynamic, GET(), EndpointDef, ENDPOINTS, legacySpec, buildOpenApiSpec(), errorRef(), Json (+5 more)

### Community 88 - "resume-parse.ts"
Cohesion: 0.20
Nodes (15): AiRateLimitError, BACKOFF, callOnce(), errStatus(), generateWithBackoff(), isDailyQuota(), log, parseLooseJsonObject() (+7 more)

### Community 89 - "transcript-dedupe.test.ts"
Cohesion: 0.16
Nodes (6): compareUserLines(), dropRepeatedUserLines(), joinTranscriptChunk(), normalizeForCompare(), RepeatKind, SaveLine

### Community 90 - "with"
Cohesion: 0.12
Nodes (16): with, build-args, cache-from, cache-to, context, envs, file, host (+8 more)

### Community 91 - "toast.tsx"
Cohesion: 0.22
Nodes (13): class-variance-authority@^0.7.1, @radix-ui/react-toast@^1.2.15, class-variance-authority, @radix-ui/react-toast, Toast, ToastActionElement, ToastClose, ToastDescription (+5 more)

### Community 92 - "ServerEvent"
Cohesion: 0.12
Nodes (16): ServerEvent, ASR_ENDED, ASR_INFO, ASR_RESPONSE, CHAT_ENDED, CHAT_RESPONSE, CONNECTION_FAILED, CONNECTION_FINISHED (+8 more)

### Community 93 - "(dashboard)/status/page.tsx"
Cohesion: 0.23
Nodes (14): displayName(), formatCheckedAt(), overallClass(), overallLabel(), sparkColor(), statusClass(), UserStatusPage(), formatAt() (+6 more)

### Community 94 - "dithered-logo.tsx"
Cohesion: 0.19
Nodes (15): applyMaskInversion(), buildRoundedMask(), DEFAULTS, DitherConfig, DitheredLogo(), DitheredLogoProps, drawParticles(), errorDiffusionDither() (+7 more)

### Community 95 - "analysis.ts"
Cohesion: 0.27
Nodes (13): lastMessageAt(), ms(), normalizeObjectPath(), objectPathFromSignedUrl(), pathBelongsToOrganization(), pathBelongsToSession(), tenantApplicationObjectPath(), tenantSessionObjectPath() (+5 more)

### Community 97 - "steps"
Cohesion: 0.13
Nodes (14): APP_URL, CRON_SECRET, jobs, purge, name, on, schedule, workflow_dispatch (+6 more)

### Community 98 - "preflight-server.ts"
Cohesion: 0.28
Nodes (12): POST(), sanitizeDetail(), sanitizeDevice(), DeviceInfo, isPreflightEventStatus(), isPreflightEventType(), authorizePreflightSource(), findLastSame() (+4 more)

### Community 99 - "usage/page.tsx"
Cohesion: 0.24
Nodes (13): CollapsibleDetailTable(), DetailTableColumn, formatDate(), formatDateTime(), formatDuration(), formatHours(), formatShortDate(), PERIOD_OPTIONS (+5 more)

### Community 100 - "interviewee-tour-provider.tsx"
Cohesion: 0.22
Nodes (12): getStepIllustration(), IntervieweeTourOverlay(), Rect, IntervieweeTourContext, IntervieweeTourContextValue, IntervieweeTourProvider(), useIntervieweeTour(), CHAT_TOUR_STEPS (+4 more)

### Community 101 - "sparkline-geometry.ts"
Cohesion: 0.20
Nodes (13): buildSparklineAreaPath(), buildSparklineLinePath(), computeSparklineDomain(), computeSparklineLayout(), curves, describeSparkline(), formatCompact(), isDefined() (+5 more)

### Community 102 - "components.json"
Cohesion: 0.14
Nodes (13): aliases, components, utils, rsc, $schema, style, tailwind, baseColor (+5 more)

### Community 103 - "db"
Cohesion: 0.14
Nodes (14): command, cpus, environment, image, mem_limit, memswap_limit, oom_score_adj, ports (+6 more)

### Community 104 - "source-must-be-dev"
Cohesion: 0.14
Nodes (13): HEAD_REF, jobs, source-must-be-dev, name, on, pull_request, branches, name (+5 more)

### Community 105 - "command.tsx"
Cohesion: 0.15
Nodes (13): cmdk@^1.1.1, @radix-ui/react-dialog@^1.1.15, cmdk, @radix-ui/react-dialog, Command, CommandDialog(), CommandEmpty, CommandGroup (+5 more)

### Community 106 - "theme-transition.tsx"
Cohesion: 0.18
Nodes (10): gsap@^3.15.0, next-themes@^0.4.6, gsap, next-themes, FlippingWordSwap(), FlippingWordSwapProps, segmentCharacters(), ThemeSwitchOverlay() (+2 more)

### Community 107 - "interviewee-guide-content.tsx"
Cohesion: 0.25
Nodes (13): ChatChannelIllustration(), ChatInputIllustration(), ChatProgressIllustration(), ChatQuestionIllustration(), getChatGuideItems(), getVoiceGuideItems(), GuideItem, MicControlIllustration() (+5 more)

### Community 108 - "interviewForm.ts"
Cohesion: 0.24
Nodes (13): defaultFormFields(), defaultInterviewConfig(), deriveApplicationStatus(), applicationHasCv(), pickCvFile(), signApplicationCv(), configSchema, Ctx (+5 more)

### Community 109 - "endpointing.ts"
Cohesion: 0.30
Nodes (11): analyzeHesitation(), ENDPOINTING_CONFIG, EndpointingConfig, decideEndpoint(), EndpointAction, EndpointDecision, EndpointDecisionInput, HesitationSignals (+3 more)

### Community 110 - "rest"
Cohesion: 0.15
Nodes (13): PGRST_DB_ANON_ROLE, PGRST_DB_MAX_ROWS, PGRST_DB_SCHEMAS, PGRST_DB_URI, PGRST_JWT_SECRET, cpus, environment, image (+5 more)

### Community 111 - "db"
Cohesion: 0.15
Nodes (13): environment, healthcheck, image, ports, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD (+5 more)

### Community 112 - "animation.ts"
Cohesion: 0.19
Nodes (8): clipRevealTransition(), DEFAULT_ANIMATION_DURATION_MS, DEFAULT_ANIMATION_EASING, DEFAULT_CHART_ENTER_TRANSITION, ChartRevealClip(), ChartRevealClipMode, ChartRevealClipProps, SpringOptions

### Community 113 - "deploy.yml"
Cohesion: 0.17
Nodes (11): concurrency, cancel-in-progress, group, env, APP_IMAGE, REGISTRY, VOICE_IMAGE, name (+3 more)

### Community 114 - "functional.test.ts"
Cohesion: 0.23
Nodes (7): APP_CWD, delay(), RelayConnection, stopProcess(), waitForCondition(), waitForHttp(), waitForText()

### Community 115 - "bestAvailableTranscript"
Cohesion: 0.30
Nodes (12): armStaleAsrGuard(), bestAvailableTranscript(), cancelOngoingResponse(), clearSpeechFinalizeTimer(), commitUserTranscript(), finalizeUserTurn(), flushPendingUserTurnBeforeAssistant(), handleSpeechStartedEvent() (+4 more)

### Community 116 - "handleWhisperCompletedTranscript"
Cohesion: 0.27
Nodes (12): clearStaleAsrGuard(), emitInterimUserTranscript(), flushUserInput(), handleVolcFinalText(), handleVolcInterimText(), handleWhisperCompletedTranscript(), handleWhisperDelta(), noteTranscriptUpdate() (+4 more)

### Community 117 - "ui/not-found.tsx"
Cohesion: 0.30
Nodes (8): GlobalError(), NotFoundPage(), DEFAULT_SEARCH_TARGETS, Illustration(), NotFound(), onSearch(), resolveSearch(), NotFoundProps

### Community 118 - "FailoverProvider"
Cohesion: 0.27
Nodes (4): FailoverProvider, isQuotaError(), modelFitsProvider(), shouldFailover()

### Community 119 - "question-conditions.ts"
Cohesion: 0.32
Nodes (10): loadAutoIncludePremade(), resolvePremadeQuestions(), enforceExactPremadeQuestions(), normalizeMatchText(), parseSkipIf(), PremadeExact, QuestionSkipIf, shouldSkipQuestion() (+2 more)

### Community 120 - "voice-functional-harness.tsx"
Cohesion: 0.24
Nodes (9): VoiceFunctionalPage(), VoiceFunctionalPageProps, FunctionalRelayEvent, FunctionalScenario, FunctionalScenarioId, functionalScenarios, installFunctionalRelayMocks(), VoiceFunctionalHarness() (+1 more)

### Community 121 - "LineOrAreaPaths"
Cohesion: 0.27
Nodes (11): BarPaths(), buildSparklineBarSegment(), buildSparklineBarsPath(), interpolateSparklineLayout(), sparklineBarWidth(), LineOrAreaPaths(), prefersReducedMotion(), sameShape() (+3 more)

### Community 122 - "interviewer-persona.ts"
Cohesion: 0.33
Nodes (9): DEFAULT_NAME_SET, getInterviewerPersona(), INTERVIEWER_GENDERS, INTERVIEWER_PERSONAS, InterviewerPersona, interviewerPromptIdentity(), isDefaultInterviewerName(), resolveGeminiVoice() (+1 more)

### Community 123 - "app"
Cohesion: 0.20
Nodes (10): cpus, env_file, image, mem_limit, memswap_limit, oom_score_adj, ports, restart (+2 more)

### Community 124 - "voice"
Cohesion: 0.20
Nodes (10): voice, cpus, env_file, image, mem_limit, memswap_limit, oom_score_adj, ports (+2 more)

### Community 125 - "interviewer.ts"
Cohesion: 0.24
Nodes (7): InterviewContext, Database, Enums, Insertable, Json, Tables, Updatable

### Community 126 - "app"
Cohesion: 0.22
Nodes (9): depends_on, env_file, image, ports, restart, volumes, rest, condition (+1 more)

### Community 127 - "rules"
Cohesion: 0.22
Nodes (8): extends, rules, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars, @typescript-eslint/no-var-requires, next/core-web-vitals, plugin:@typescript-eslint/recommended

### Community 128 - "steps"
Cohesion: 0.22
Nodes (9): name, runs-on, steps, jobs, deploy, id, name, run (+1 more)

### Community 129 - "repository"
Cohesion: 0.14
Nodes (9): @radix-ui/react-tooltip@^1.2.8, @ricky0123/vad-web@^0.0.31, @trpc/next@^10.45.4, repository, type, url, @radix-ui/react-tooltip, @ricky0123/vad-web (+1 more)

### Community 130 - "network-security.ts"
Cohesion: 0.36
Nodes (4): GET(), assertSafeRemoteUrl(), isPrivateIp(), getFreePort()

### Community 131 - "voice-relay-helpers.ts"
Cohesion: 0.33
Nodes (7): isUserEndRequest(), isUserSkipRequest(), REPLY_INVITES_MORE_PATTERNS_EN, REPLY_INVITES_MORE_PATTERNS_ZH, responseInvitesUserReply(), USER_END_PATTERNS, USER_SKIP_PATTERNS

### Community 132 - "chat/route.ts"
Cohesion: 0.39
Nodes (7): log, POST(), taskFromFollowUpDepth(), buildCandidateFocusSection(), hasCandidateFocus(), resolveProvider(), nextAskableQuestionIndex()

### Community 133 - "services"
Cohesion: 0.25
Nodes (7): name, services, volumes, skillmark-dev-pg, skillmark-dev-storage, x-log, logging

### Community 134 - "caddy"
Cohesion: 0.25
Nodes (8): depends_on, environment, image, ports, restart, volumes, SITE_ADDRESS, caddy

### Community 135 - "webhooks.ts"
Cohesion: 0.36
Nodes (5): computeWebhookSignature(), log, verifyWebhookSignature(), WebhookEventName, WebhookPayload

### Community 136 - "token/route.ts"
Cohesion: 0.39
Nodes (5): log, POST(), assertActiveInterviewSession(), SessionAccessResult, TENANT_COPY

### Community 137 - "chart-defs.ts"
Cohesion: 0.46
Nodes (7): collectChartDefsChildren(), getChartChildComponentName(), isChartDefsComponent(), isGradientDefComponent(), isPatternDefComponent(), partitionChartDefNodes(), VISX_PATTERN_COMPONENT_NAMES

### Community 138 - "supabase/client.ts"
Cohesion: 0.25
Nodes (5): AuthError, AuthUser, client, Listener, listeners

### Community 139 - "options"
Cohesion: 0.29
Nodes (7): logging, logging, options, max-file, max-size, logging, logging

### Community 140 - "services"
Cohesion: 0.29
Nodes (6): name, services, voice, env_file, image, restart

### Community 141 - "rest"
Cohesion: 0.29
Nodes (7): condition, db, depends_on, image, ports, restart, rest

### Community 142 - "whiteboard-canvas.tsx"
Cohesion: 0.29
Nodes (4): @excalidraw/excalidraw@^0.18.0, @excalidraw/excalidraw, ExcalidrawAPI, WhiteboardCanvasProps

### Community 143 - "generate-mic-test-audio.mjs"
Cohesion: 0.33
Nodes (4): outDir, pcmToWav(), synthesize(), texts

### Community 144 - "context.ts"
Cohesion: 0.52
Nodes (4): handler(), serverTrpc(), createContext(), appRouter

### Community 145 - "chart-parent-size.tsx"
Cohesion: 0.38
Nodes (6): ChartParentSizeProps, ElementSize, readElementSize(), useElementSize(), useIsomorphicLayoutEffect, ZERO_SIZE

### Community 146 - "depends_on"
Cohesion: 0.33
Nodes (6): depends_on, condition, db, rest, condition, depends_on

### Community 147 - "environment"
Cohesion: 0.33
Nodes (6): environment, HOSTNAME, NODE_ENV, PORT, POSTGREST_URL, STORAGE_DIR

### Community 148 - "healthcheck"
Cohesion: 0.33
Nodes (6): healthcheck, interval, retries, start_period, test, timeout

### Community 149 - "environment"
Cohesion: 0.33
Nodes (6): GEMINI_VOICE_RELAY_PORT, OPENAI_VOICE_RELAY_PORT, VOICE_RELAY_HOST, VOICE_RELAY_PORT, VOICE_RELAY_PROVIDER, environment

### Community 150 - "environment"
Cohesion: 0.33
Nodes (6): environment, HOSTNAME, NODE_ENV, PORT, POSTGREST_URL, STORAGE_DIR

### Community 151 - "environment"
Cohesion: 0.33
Nodes (6): GEMINI_VOICE_RELAY_PORT, OPENAI_VOICE_RELAY_PORT, VOICE_RELAY_HOST, VOICE_RELAY_PORT, VOICE_RELAY_PROVIDER, environment

### Community 152 - "environment"
Cohesion: 0.33
Nodes (6): PGRST_DB_ANON_ROLE, PGRST_DB_MAX_ROWS, PGRST_DB_SCHEMAS, PGRST_DB_URI, PGRST_JWT_SECRET, environment

### Community 153 - "tailwindcss"
Cohesion: 0.33
Nodes (5): tailwindcss-animate@^1.0.7, tailwindcss@^3.4.1, tailwindcss, tailwindcss-animate, config

### Community 154 - "voice-entrypoint.sh"
Cohesion: 0.33
Nodes (5): GEMINI_VOICE_RELAY_PORT, OPENAI_VOICE_RELAY_PORT, voice-entrypoint.sh script, VOICE_RELAY_HOST, VOICE_RELAY_PORT

### Community 155 - "normalizeTranscript"
Cohesion: 0.73
Nodes (6): findRecentVoiceTranscriptMatch(), findTrailingVoiceDuplicateCluster(), isBriefStandaloneVoiceUtterance(), isExpandedTranscript(), normalizeTranscript(), upsertFinalVoiceTranscript()

### Community 156 - "LineOrArea"
Cohesion: 0.40
Nodes (6): AreaSparklineImpl(), BarSparklineImpl(), resolveSparklinePadding(), LineOrArea(), LineSparklineImpl(), resolveHoverSpring()

### Community 157 - "HoverMarksView"
Cohesion: 0.40
Nodes (6): HoverMarks(), HoverMarksView(), HoverOverlay(), SparklineCrosshairLine(), SparklineDot(), SpringHoverMarks()

### Community 158 - "interview-templates.ts"
Cohesion: 0.47
Nodes (4): INTERVIEW_TEMPLATES, InterviewTemplate, TemplateQuestion, QUESTION_TYPES

### Community 159 - "session-score.ts"
Cohesion: 0.47
Nodes (4): averageScore(), ScoreEntry, SessionScoreInsights, usesQuestionEvaluationScore()

### Community 160 - "time-range.ts"
Cohesion: 0.60
Nodes (4): latestTimestamp(), RANGE_MS, startOfToday(), timeRangeCutoff()

### Community 161 - "volumes"
Cohesion: 0.40
Nodes (5): volumes, caddy-config, caddy-data, skillmark-pg, skillmark-storage

### Community 162 - "on"
Cohesion: 0.50
Nodes (4): on, push, workflow_dispatch, branches

### Community 163 - "onnxruntime-web"
Cohesion: 0.50
Nodes (3): onnxruntime-web@^1.31.1, onnxruntime-web, onnxruntime-web/wasm

### Community 165 - "analytics.ts"
Cohesion: 0.67
Nodes (3): GtagEvent, trackCtaClick(), trackEvent()

## Knowledge Gaps
- **21 isolated node(s):** `next/core-web-vitals`, `plugin:@typescript-eslint/recommended`, `GEMINI_VOICE_RELAY_PORT`, `OPENAI_VOICE_RELAY_PORT`, `VOICE_RELAY_HOST` (+16 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 1381 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `react` to `candidate-manager.tsx`, `Skeleton`, `Button`, `docs/index.ts`, `ai-generator.tsx`, `cn`, `chart-defs.ts`, `dependencies`, `platform-ops.ts`, `session-report-view.tsx`, `whiteboard-canvas.tsx`, `package.json`, `chart-parent-size.tsx`, `use-voice.ts`, `interviewee-onboarding.tsx`, `code-editor-canvas.tsx`, `config/page.tsx`, `api-reference.tsx`, `liquid-glass-logo-reveal.tsx`, `preflight.ts`, `connect/page.tsx`, `pie-chart.tsx`, `static-chart-preview-context.tsx`, `head-movement-guard.tsx`, `[token]/session/page.tsx`, `sparkline.tsx`, `head-movement.ts`, `tour-provider.tsx`, `providers.tsx`, `gauge.tsx`, `gauge-label-layout.tsx`, `patterns/index.ts`, `motion`, `(dashboard)/integrations/page.tsx`, `settings/ai/page.tsx`, `particle-text.tsx`, `use-interview-recording.ts`, `form.tsx`, `session-link-server.ts`, `toast.tsx`, `(dashboard)/status/page.tsx`, `dithered-logo.tsx`, `usage/page.tsx`, `interviewee-tour-provider.tsx`, `command.tsx`, `theme-transition.tsx`, `ui/not-found.tsx`, `voice-functional-harness.tsx`?**
  _High betweenness centrality (0.127) - this node is a cross-community bridge._
- **What connects `next/core-web-vitals`, `plugin:@typescript-eslint/recommended`, `GEMINI_VOICE_RELAY_PORT` to the rest of the system?**
  _21 weakly-connected nodes found - possible missing edges._
- **Should `candidate-manager.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.03873744619799139 - nodes in this community are weakly interconnected._
- **Why does `next` connect `next` to `candidate-manager.tsx`, `react`, `Skeleton`, `network-security.ts`, `chat/route.ts`, `docs/index.ts`, `logger.ts`, `ai-generator.tsx`, `token/route.ts`, `Button`, `batch.ts`, `dependencies`, `cn`, `admin.ts`, `package.json`, `api-reference.tsx`, `save/route.ts`, `connect/page.tsx`, `recording-parts-server.ts`, `storage.ts`, `[token]/session/page.tsx`, `tour-provider.tsx`, `billing.ts`, `retranscribe.ts`, `providers.tsx`, `capture-readme-screenshots.mjs`, `volcengine-protocol.ts`, `settings/ai/page.tsx`, `session-link-server.ts`, `preflight-server.ts`, `usage/page.tsx`, `ui/not-found.tsx`, `voice-functional-harness.tsx`?**
  _High betweenness centrality (0.099) - this node is a cross-community bridge._
- **Should `react` be split into smaller, more focused modules?**
  _Cohesion score 0.05764944275582574 - nodes in this community are weakly interconnected._
- **Why does `cn()` connect `cn` to `candidate-manager.tsx`, `react`, `Skeleton`, `Button`, `docs/index.ts`, `ai-generator.tsx`, `platform-ops.ts`, `session-report-view.tsx`, `interviewee-onboarding.tsx`, `config/page.tsx`, `api-reference.tsx`, `liquid-glass-logo-reveal.tsx`, `preflight.ts`, `connect/page.tsx`, `pie-chart.tsx`, `sparkline.tsx`, `gauge.tsx`, `gauge-label-layout.tsx`, `patterns/index.ts`, `(dashboard)/integrations/page.tsx`, `settings/ai/page.tsx`, `form.tsx`, `toast.tsx`, `(dashboard)/status/page.tsx`, `dithered-logo.tsx`, `usage/page.tsx`, `sparkline-geometry.ts`, `command.tsx`, `theme-transition.tsx`, `interviewee-guide-content.tsx`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Should `Skeleton` be split into smaller, more focused modules?**
  _Cohesion score 0.05337004982953055 - nodes in this community are weakly interconnected._