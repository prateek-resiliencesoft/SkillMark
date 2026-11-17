# Graph Report - SkillMark  (2026-11-17)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 4439 nodes · 14573 edges · 181 communities (164 shown, 17 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS · INFERRED: 50 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b4e1b32f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63
- Community 64
- Community 65
- Community 66
- Community 67
- Community 68
- Community 69
- Community 70
- Community 71
- Community 72
- Community 73
- Community 74
- Community 75
- Community 76
- Community 77
- Community 78
- Community 79
- Community 80
- Community 81
- Community 82
- Community 83
- Community 84
- Community 85
- Community 86
- Community 87
- Community 88
- Community 89
- Community 90
- Community 91
- Community 92
- Community 93
- Community 94
- Community 95
- Community 96
- Community 97
- Community 98
- Community 99
- Community 100
- Community 101
- Community 102
- Community 103
- Community 104
- Community 105
- Community 106
- Community 107
- Community 108
- Community 109
- Community 110
- Community 111
- Community 112
- Community 113
- Community 114
- Community 115
- Community 116
- Community 117
- Community 118
- Community 119
- Community 120
- Community 121
- Community 122
- Community 123
- Community 124
- Community 125
- Community 126
- Community 127
- Community 128
- Community 129
- Community 130
- Community 131
- Community 132
- Community 133
- Community 134
- Community 135
- Community 136
- Community 137
- Community 138
- Community 139
- Community 140
- Community 141
- Community 142
- Community 143
- Community 144
- Community 145
- Community 146
- Community 147
- Community 148
- Community 149
- Community 150
- Community 151
- Community 152
- Community 153
- Community 154
- Community 155
- Community 156
- Community 157
- Community 158
- Community 159
- Community 160
- Community 161
- Community 162
- Community 163
- Community 164
- Community 165
- Community 166
- Community 167
- Community 168
- Community 169
- Community 170
- Community 171
- Community 172
- Community 173
- Community 174
- Community 175
- Community 176
- Community 180

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

### Community 0 - "Community 0"
Cohesion: 0.04
Nodes (165): CandidateRow, CandidatesPage(), getCellValue(), ColumnDef, COLUMNS, DEFAULT_VISIBLE, formatDate(), formatDuration() (+157 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (87): lucide-react, react, LoginPage(), RegisterPage(), AccountPage(), BatchesPage(), Stat(), DashboardPage() (+79 more)

### Community 2 - "Community 2"
Cohesion: 0.05
Nodes (87): AdminActivityPage(), metaBits(), AdminOrgAiPage(), ProviderId, AdminOrgIntegrationsPage(), AdminOrganizationDetailPage(), limitInputValue(), MEMBER_ROLES (+79 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (89): DEFAULT_SCOPES, DevelopersPage(), OTHER_SCOPES, RESULT_SCOPES, Tab, TABS, when(), EditInterviewContext (+81 more)

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (62): AdminLayout(), CategoryLayout(), CategoryPage(), generateMetadata(), ArticlePage(), generateMetadata(), generateStaticParams(), DocsHomePage() (+54 more)

### Community 5 - "Community 5"
Cohesion: 0.08
Nodes (70): BatchDetailPage(), Filter, InviteState(), isInviteExpired(), Status, STATUS_META, InterviewFormBuilderPage(), normalizeInterviewLanguage() (+62 more)

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (66): htmlToText(), log, pdfParse, POST(), STRIPPED_TAGS, truncate(), log, POST() (+58 more)

### Community 7 - "Community 7"
Cohesion: 0.06
Nodes (52): InterviewFormIntegrationLayout(), tabs, DataTableWrapper(), TableRow(), Account, AccountSwitcher(), loginUrl(), Header() (+44 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (53): jose, next, dynamic, GET(), POST(), POST(), POST(), POST() (+45 more)

### Community 9 - "Community 9"
Cohesion: 0.06
Nodes (66): authRequest(), CORS, DELETE, dynamic, GET, handle(), POST, runtime (+58 more)

### Community 10 - "Community 10"
Cohesion: 0.08
Nodes (63): server-only, inboundCandidateSchema, POST(), completionNotifyMembersSchema, profileToResumeText(), RESILIO_DEFAULT_BASE_URL, sendBrevoEmail(), sendResendEmail() (+55 more)

### Community 11 - "Community 11"
Cohesion: 0.03
Nodes (73): dependencies, aws4fetch@^1.0.20, bcryptjs@^2.4.3, bufferutil@^4.1.0, clsx@^2.1.1, domutils@^3.2.2, dotenv@^17.3.1, fix-webm-duration@^1.0.6 (+65 more)

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (61): AdminServerActivityPage(), last(), MetricChart(), pct(), peak(), rate(), timeLabel(), clampSeconds() (+53 more)

### Community 13 - "Community 13"
Cohesion: 0.07
Nodes (51): MM_TO_PX, REC_COLOR, REC_TEXT, ReportDocumentProps, CountUp(), ExpandableText(), REC, RecommendationBadge() (+43 more)

### Community 14 - "Community 14"
Cohesion: 0.10
Nodes (46): CandidateInput, GET(), normalizeCandidateInput(), POST(), POST(), GET(), interviewAccessError(), normalizeOne() (+38 more)

### Community 15 - "Community 15"
Cohesion: 0.04
Nodes (56): author, bugs, url, canvas-confetti@^1.9.4, html2canvas-pro@^1.6.7, @hugeicons/core-free-icons@^4.3.5, @modelcontextprotocol/sdk@^1.32.2, pdf-parse@^1.1.1 (+48 more)

### Community 16 - "Community 16"
Cohesion: 0.11
Nodes (44): @trpc/server, zod, questionSkipIfSchema, normalizeReportTemplate(), Db, DeletedKey, deleteOrgApiKey(), apiKeyRouter (+36 more)

### Community 17 - "Community 17"
Cohesion: 0.07
Nodes (41): float32ToPcmHex(), log, TrackedMessage, useVoice(), UseVoiceOptions, VoiceState, JITTER_BUFFER_ADAPTIVE_MAX_MS, JITTER_BUFFER_LOW_WATER_MS (+33 more)

### Community 18 - "Community 18"
Cohesion: 0.08
Nodes (45): VoiceSaveOps, g, log, startReportSweeper(), ContentStats, contentStats(), decideReport(), EMPTY_SESSION_IDLE_MS (+37 more)

### Community 19 - "Community 19"
Cohesion: 0.08
Nodes (43): CodeBlock(), CodeBlockProps, LANG_MAP, toPrismLang(), CodeEditorCanvas, CodeEditorCanvasRef, ChatInterface(), getAIResponse() (+35 more)

### Community 20 - "Community 20"
Cohesion: 0.09
Nodes (46): checkVoiceModel(), isVoiceCapableProvider(), PROVIDER_CAPS, ProviderCapId, ProviderCaps, TEXT_ONLY, VOICE_OK, VOICE_PROVIDER_IDS (+38 more)

### Community 21 - "Community 21"
Cohesion: 0.04
Nodes (47): concurrency, cancel-in-progress, group, name, runs-on, steps, env, APP_IMAGE (+39 more)

### Community 22 - "Community 22"
Cohesion: 0.10
Nodes (20): openai@^6.22.0, openai, AnthropicContent, AnthropicProvider, splitMessages(), CompatibleOpenAIProvider, CompatibleProviderOptions, enrichOpenAIError() (+12 more)

### Community 23 - "Community 23"
Cohesion: 0.08
Nodes (30): CodeEditorCanvasProps, CodeRunOutput, EditorState, parseState(), runCodeRequest(), Starter, SUPPORTED_LANGUAGES, ALIASES (+22 more)

### Community 24 - "Community 24"
Cohesion: 0.10
Nodes (40): AdminConfigPage(), fromDraft(), limitField(), parseLimit(), PlanDraft, toDraft(), DEFAULT_PLAN_CATALOG, DEFAULT_PLAN_FEATURES (+32 more)

### Community 25 - "Community 25"
Cohesion: 0.07
Nodes (37): CODING_DONE_PATTERNS, connectGemini(), connectGeminiWithKey(), FAST_NEXT_PATTERNS, FAST_PREV_PATTERNS, GEMINI_TOOLS, GeminiConnectOpts, GeminiMsg (+29 more)

### Community 26 - "Community 26"
Cohesion: 0.10
Nodes (38): ApiDocsPage(), ApiReference(), CodeBlock(), CopyButton(), IdPicker(), Lang, loadPicks(), METHOD_BADGE (+30 more)

### Community 27 - "Community 27"
Cohesion: 0.07
Nodes (21): buildRelayTargets(), deriveSiblingRelayUrl(), deriveUrlFromBrowser(), isLocalBrowserHost(), normalizeBinaryData(), RelayConnectedContext, RelayConnector, RelayConnectorOptions (+13 more)

### Community 28 - "Community 28"
Cohesion: 0.11
Nodes (31): GET(), POST(), runtime, submitLimited(), submits, POST(), log, POST() (+23 more)

### Community 29 - "Community 29"
Cohesion: 0.09
Nodes (36): buildSdf(), clamp01(), createRenderer(), edt(), edt1d(), endOf(), fitToTexture(), Frame (+28 more)

### Community 30 - "Community 30"
Cohesion: 0.10
Nodes (30): fmtTime(), PreflightProgress(), statusText(), PreflightContext, PreflightProvider(), ReportFn, buildPreflightTimeline(), collectDeviceInfo() (+22 more)

### Community 31 - "Community 31"
Cohesion: 0.15
Nodes (32): CodeTab(), FormPicker(), McpTab(), MyIntegrationsInner(), MyIntegrationsPage(), Step(), PublicForm, CodeBlock() (+24 more)

### Community 32 - "Community 32"
Cohesion: 0.12
Nodes (27): log, POST(), groupRecordingParts(), isRunComplete(), mimeForRecordingExt(), parseRecordingPartKey(), RECORDING_PART_EXTS, recordingExtForMime() (+19 more)

### Community 33 - "Community 33"
Cohesion: 0.13
Nodes (29): nextConfig, GET(), clearStoredMedia(), copyStoredObject(), deletePrefix(), Err, getStorageConfigSummary(), isObjectStorageEnabled() (+21 more)

### Community 34 - "Community 34"
Cohesion: 0.11
Nodes (28): d3-shape@^3.2.0, @visx/shape@^4.0.0, d3-shape, @visx/shape, ParentSize(), PieCenter(), PieCenterShell(), PieCenterShellProps (+20 more)

### Community 35 - "Community 35"
Cohesion: 0.08
Nodes (29): ASR_PRIMARY, AZURE_VOICE, buildSystemPrompt(), CODING_DONE_PATTERNS, FAST_NEXT_PATTERNS, FAST_PREV_PATTERNS, handleCommittedUserText(), tryHandleExplicitUserNavigation() (+21 more)

### Community 36 - "Community 36"
Cohesion: 0.06
Nodes (30): condition, environment, healthcheck, image, ports, restart, volumes, db (+22 more)

### Community 37 - "Community 37"
Cohesion: 0.06
Nodes (31): AUTH_SECRET, AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, CODE_RUNNER_API_KEY, CRON_SECRET, DOUBAO_ACCESS_TOKEN, DOUBAO_APP_ID, GEMINI_API_KEY (+23 more)

### Community 38 - "Community 38"
Cohesion: 0.08
Nodes (29): ws@^8.19.0, ws, AgentContext, callLLM(), CORRECTION_PATTERNS_EN, CORRECTION_PATTERNS_ZH, describeWhiteboard(), extractText() (+21 more)

### Community 39 - "Community 39"
Cohesion: 0.12
Nodes (28): log, maxDuration, POST(), loadOrgAiCredentials(), countPages(), detectKind(), DocKind, extractDocument() (+20 more)

### Community 40 - "Community 40"
Cohesion: 0.13
Nodes (23): AntiCheatingGuard(), AntiCheatingGuardProps, ModalState, HeadMovementGuard(), ModalState, Props, AntiCheatingViolation, useAntiCheating() (+15 more)

### Community 41 - "Community 41"
Cohesion: 0.12
Nodes (4): DEFAULT_QUESTION_BANK_SECTIONS, FILES, ROOT, relayPath

### Community 42 - "Community 42"
Cohesion: 0.11
Nodes (26): clientIp(), CORS, dynamic, GET(), runtime, cfg(), CreateMonitorInput, CreateMonitorResult (+18 more)

### Community 43 - "Community 43"
Cohesion: 0.18
Nodes (22): InvitePage(), SessionLoading(), ChatInterface, InviteSessionPage(), VoiceInterface, SessionLoading(), ChatInterface, SlugSessionPage() (+14 more)

### Community 44 - "Community 44"
Cohesion: 0.10
Nodes (27): chartCssVars, defaultScatterColors, AnimatedNumber, AreaSparklineProps, BarSparklineProps, DATA_TRANSITION_EASE, DEFAULT_SPARKLINE_ANIMATION_DURATION_MS, DEFAULT_SPARKLINE_DATA_TRANSITION_MS (+19 more)

### Community 45 - "Community 45"
Cohesion: 0.10
Nodes (26): API_KEY_SCOPE_LABELS, API_KEY_SCOPES, ApiKeyEnvironment, ApiKeyScope, LEGACY_READ_IMPLIES, exampleSession, Candidate, CreateInviteBody (+18 more)

### Community 46 - "Community 46"
Cohesion: 0.13
Nodes (18): @mediapipe/tasks-vision@^1.2.0, @mediapipe/tasks-vision, exists(), Options, useHeadMovementDetection(), suppressDetections(), classifyFrame(), countHeadViolations() (+10 more)

### Community 47 - "Community 47"
Cohesion: 0.12
Nodes (22): react-dom@^18, react-dom, BRAND_COLORS, fireConfetti(), TourCelebration(), getStepNavUrl(), TourChecklist(), TourChecklistProps (+14 more)

### Community 48 - "Community 48"
Cohesion: 0.16
Nodes (22): applySubscription(), dynamic, findOrgIdByCustomer(), log, POST(), runtime, formatLimit(), OrgPlanId (+14 more)

### Community 49 - "Community 49"
Cohesion: 0.12
Nodes (23): CvRow, closeTruncatedJson(), extractBalancedObject(), extractJson(), log, sanitiseJsonString(), stripTrailingCommas(), resolveFallbackProviders() (+15 more)

### Community 50 - "Community 50"
Cohesion: 0.13
Nodes (23): dynamic, hasInternalSecret(), log, maxDuration, POST(), storage, buildPrompt(), callGemini() (+15 more)

### Community 51 - "Community 51"
Cohesion: 0.20
Nodes (24): runEndpoint(), ApiAuth, ApiDb, ApiProblem, CANDIDATE_STATUS, candidateFor(), createInvite(), decodeCursor() (+16 more)

### Community 52 - "Community 52"
Cohesion: 0.08
Nodes (24): name, runs-on, steps, concurrency, cancel-in-progress, group, AUTH_SECRET, NEXT_PUBLIC_APP_URL (+16 more)

### Community 53 - "Community 53"
Cohesion: 0.11
Nodes (22): superjson@^2.2.6, @tanstack/react-query@^4.43.0, @trpc/client@^10.45.4, superjson, @tanstack/react-query, @trpc/client, ibmPlexSansCondensed, inter (+14 more)

### Community 54 - "Community 54"
Cohesion: 0.23
Nodes (25): buildSystemPrompt(), handleInterview(), armResponseWatchdog(), attach(), beginEnding(), checkStuckClientTurn(), clearResponseWatchdog(), endModelTurn() (+17 more)

### Community 55 - "Community 55"
Cohesion: 0.20
Nodes (24): buildChoiceSuffix(), buildFarewellSayHello(), buildGreeting(), buildResumeGreeting(), buildReturnSayHello(), buildSystemText(), buildTransitionSayHello(), buildTTSOptions() (+16 more)

### Community 56 - "Community 56"
Cohesion: 0.18
Nodes (23): DEFAULT_NOTCH_ENTER_TRANSITION, Gauge(), GaugeArcInner(), GaugeInner(), GaugeInnerProps, GaugeLinearInner(), GaugeNotchSvg(), GaugeOrientation (+15 more)

### Community 57 - "Community 57"
Cohesion: 0.16
Nodes (21): nanoid(), listPreflightEventsWithStatus(), expireIfStale(), expireNestedSession(), expireSessionsIfStale(), Db, fallbackQuestions(), generateTailoredQuestions() (+13 more)

### Community 58 - "Community 58"
Cohesion: 0.13
Nodes (22): PROMPTS, ResponsePromptParams, SPOKEN, AI_TONE_ZH, AI_TONE_ZH_DEFAULT, BiText, getLanguageKey(), getMicTestMessage() (+14 more)

### Community 59 - "Community 59"
Cohesion: 0.12
Nodes (18): dynamic, GET, dynamic, POST, dynamic, GET, dynamic, GET (+10 more)

### Community 60 - "Community 60"
Cohesion: 0.14
Nodes (23): AiTaskKind, ResolvedAiCredentials, routingForTask(), buildFromCreds(), ChainEntry, customModels(), geminiModels(), GENERATOR_MODEL (+15 more)

### Community 61 - "Community 61"
Cohesion: 0.17
Nodes (20): CATEGORY_LABELS, createClientErrorLimiter(), entryFromError(), ERROR_CATEGORIES, ERROR_SEVERITIES, ErrorCategory, errorLogToCsv(), ErrorSeverity (+12 more)

### Community 62 - "Community 62"
Cohesion: 0.14
Nodes (22): authDb, defaultUptimeVisibility(), loadUptimeVisibility(), parseUptimeVisibility(), saveUptimeVisibility(), seedUptimeVisibilityIfNeeded(), UptimeVisibility, setUserPaused() (+14 more)

### Community 63 - "Community 63"
Cohesion: 0.11
Nodes (6): FailsafeReason, MicChunk, QuestionReport, VAD_FAILSAFE_CONFIG, VadFailsafe, feed()

### Community 64 - "Community 64"
Cohesion: 0.13
Nodes (21): countOrgSeats(), filterInput, getInterviewIds(), getProjectIds(), Period, periodEnum, resolveCalendarPeriod(), resolveOrgId() (+13 more)

### Community 65 - "Community 65"
Cohesion: 0.10
Nodes (13): playwright@^1.58.2, playwright, __dirname, docs, marketing, root, shot(), shots (+5 more)

### Community 66 - "Community 66"
Cohesion: 0.19
Nodes (23): handleInterview(), attachOaiHandlers(), buildRealtimeAudioInputConfig(), cleanupVolcAsr(), clearPendingTransition(), clearQuestionPrompt(), connectOai(), disableTools() (+15 more)

### Community 67 - "Community 67"
Cohesion: 0.17
Nodes (18): GET(), log, POST(), applyAntiCheatingViolation(), countStrikes(), applyMediaReview(), archiveSessionData(), clearSessionMediaStorage() (+10 more)

### Community 68 - "Community 68"
Cohesion: 0.17
Nodes (18): chartCenterContainerClassName, chartCenterLabelClassName, chartCenterValueClassName, ChartStatFlow(), ChartStatFlowFormat, ChartStatFlowProps, defaultChartStatFlowFormat, formatStatValue() (+10 more)

### Community 69 - "Community 69"
Cohesion: 0.22
Nodes (15): Circles(), PatternCirclesProps, PatternOrientation, PatternOrientationType, Hexagons(), PatternHexagonsProps, Lines(), pathForOrientation() (+7 more)

### Community 70 - "Community 70"
Cohesion: 0.09
Nodes (21): bypass_actors, conditions, ref_name, enforcement, name, allowed_merge_methods, dismiss_stale_reviews_on_push, do_not_enforce_on_create (+13 more)

### Community 71 - "Community 71"
Cohesion: 0.18
Nodes (15): motion, usePie(), usePieHover(), usePieStable(), AnimatedSliceGrow(), AnimatedSliceGrowProps, AnimatedSliceTranslate(), AnimatedSliceTranslateProps (+7 more)

### Community 72 - "Community 72"
Cohesion: 0.20
Nodes (19): handleMicTestConnection(), cleanup(), buildFinishConnection(), buildFinishSession(), buildSendAudio(), buildStartConnection(), buildStartSession(), CLIENT_AUDIO_ONLY_REQUEST (+11 more)

### Community 73 - "Community 73"
Cohesion: 0.15
Nodes (21): BrevoLogo(), CategoryRail(), EmailPane, Field(), generateRandomSecret(), IntegrationsSettingsPage(), OUTBOUND_EVENT_OPTIONS, ProviderTile() (+13 more)

### Community 74 - "Community 74"
Cohesion: 0.20
Nodes (13): backend_ready(), ensure(), handle(), idle_loop(), listen_hosts(), log(), main(), mem_available_mb() (+5 more)

### Community 75 - "Community 75"
Cohesion: 0.11
Nodes (19): AnthropicLogo(), CustomLlmLogo(), emptySlots(), GeminiLogo(), KeySlot, newSlot(), NvidiaLogo(), OpenAiLogo() (+11 more)

### Community 76 - "Community 76"
Cohesion: 0.13
Nodes (18): clamp(), easeInFall(), easeInOutCubic(), easeOutCubic(), FADE_FLOOR, fadeAlpha(), Particle, ParticleText() (+10 more)

### Community 77 - "Community 77"
Cohesion: 0.19
Nodes (18): alignCandidateTurns(), AlignedTurn, AnchorMessage, bigrams(), buildEchoIndex(), EchoIndex, echoScore(), isInterviewerEcho() (+10 more)

### Community 78 - "Community 78"
Cohesion: 0.16
Nodes (15): MCP_KEY_PLACEHOLDER, mcpConfigs(), ACCEPTED_PREFIXES, API_KEY_PREFIX, generateApiKey(), hashApiKey(), looksLikeApiKey(), parseBearerKey() (+7 more)

### Community 79 - "Community 79"
Cohesion: 0.16
Nodes (17): buildInterviewerPrompt(), getInterviewLanguageDisplayName(), getInterviewLanguageStyle(), INTERVIEW_GEMINI_LANGUAGE_CODE, INTERVIEW_LANGUAGE_CODES, INTERVIEW_LANGUAGE_DISPLAY, INTERVIEW_LANGUAGE_STYLE, INTERVIEW_SPEECH_LOCALE (+9 more)

### Community 80 - "Community 80"
Cohesion: 0.17
Nodes (18): acceptOrgInviteForUser(), AcceptOrgInviteResult, ensureProjectMembersPopulated(), normalizeEmail(), Supabase, assertQuota(), countOrgInterviews(), countOrgProjects() (+10 more)

### Community 81 - "Community 81"
Cohesion: 0.10
Nodes (19): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+11 more)

### Community 82 - "Community 82"
Cohesion: 0.11
Nodes (19): scripts, build, db:down, db:dump, db:migrate, db:psql, db:restore, db:up (+11 more)

### Community 83 - "Community 83"
Cohesion: 0.18
Nodes (16): connectVolcAsr(), reconnectVolcAsr(), sendAudioToVolc(), handleMicTest(), cleanup(), connectMicTestVolcAsr(), resample16to24(), AsrResponse (+8 more)

### Community 84 - "Community 84"
Cohesion: 0.19
Nodes (17): log, PendingPart, resolveBlobDuration(), cleanup(), finish(), ScreenshotEntry, useInterviewRecording(), UseInterviewRecordingOptions (+9 more)

### Community 85 - "Community 85"
Cohesion: 0.14
Nodes (16): @radix-ui/react-label@^2.1.8, @radix-ui/react-slot@^1.2.4, react-hook-form@^7.71.1, @radix-ui/react-label, @radix-ui/react-slot, react-hook-form, FormControl, FormDescription (+8 more)

### Community 86 - "Community 86"
Cohesion: 0.22
Nodes (12): POST(), isPreflightStale(), preflightLastActivityAt(), reachedClosing(), EndReason, HEARTBEAT_GRACE_MS, HEARTBEAT_INTERVAL_MS, isHeartbeatStale() (+4 more)

### Community 87 - "Community 87"
Cohesion: 0.19
Nodes (13): dynamic, GET(), EndpointDef, ENDPOINTS, legacySpec, buildOpenApiSpec(), errorRef(), Json (+5 more)

### Community 88 - "Community 88"
Cohesion: 0.20
Nodes (15): AiRateLimitError, BACKOFF, callOnce(), errStatus(), generateWithBackoff(), isDailyQuota(), log, parseLooseJsonObject() (+7 more)

### Community 89 - "Community 89"
Cohesion: 0.16
Nodes (6): compareUserLines(), dropRepeatedUserLines(), joinTranscriptChunk(), normalizeForCompare(), RepeatKind, SaveLine

### Community 90 - "Community 90"
Cohesion: 0.12
Nodes (16): with, build-args, cache-from, cache-to, context, envs, file, host (+8 more)

### Community 91 - "Community 91"
Cohesion: 0.22
Nodes (13): class-variance-authority@^0.7.1, @radix-ui/react-toast@^1.2.15, class-variance-authority, @radix-ui/react-toast, Toast, ToastActionElement, ToastClose, ToastDescription (+5 more)

### Community 92 - "Community 92"
Cohesion: 0.12
Nodes (16): ServerEvent, ASR_ENDED, ASR_INFO, ASR_RESPONSE, CHAT_ENDED, CHAT_RESPONSE, CONNECTION_FAILED, CONNECTION_FINISHED (+8 more)

### Community 93 - "Community 93"
Cohesion: 0.23
Nodes (14): displayName(), formatCheckedAt(), overallClass(), overallLabel(), sparkColor(), statusClass(), UserStatusPage(), formatAt() (+6 more)

### Community 94 - "Community 94"
Cohesion: 0.19
Nodes (15): applyMaskInversion(), buildRoundedMask(), DEFAULTS, DitherConfig, DitheredLogo(), DitheredLogoProps, drawParticles(), errorDiffusionDither() (+7 more)

### Community 95 - "Community 95"
Cohesion: 0.27
Nodes (13): lastMessageAt(), ms(), normalizeObjectPath(), objectPathFromSignedUrl(), pathBelongsToOrganization(), pathBelongsToSession(), tenantApplicationObjectPath(), tenantSessionObjectPath() (+5 more)

### Community 97 - "Community 97"
Cohesion: 0.13
Nodes (14): APP_URL, CRON_SECRET, jobs, purge, name, on, schedule, workflow_dispatch (+6 more)

### Community 98 - "Community 98"
Cohesion: 0.28
Nodes (12): POST(), sanitizeDetail(), sanitizeDevice(), DeviceInfo, isPreflightEventStatus(), isPreflightEventType(), authorizePreflightSource(), findLastSame() (+4 more)

### Community 99 - "Community 99"
Cohesion: 0.24
Nodes (13): CollapsibleDetailTable(), DetailTableColumn, formatDate(), formatDateTime(), formatDuration(), formatHours(), formatShortDate(), PERIOD_OPTIONS (+5 more)

### Community 100 - "Community 100"
Cohesion: 0.22
Nodes (12): getStepIllustration(), IntervieweeTourOverlay(), Rect, IntervieweeTourContext, IntervieweeTourContextValue, IntervieweeTourProvider(), useIntervieweeTour(), CHAT_TOUR_STEPS (+4 more)

### Community 101 - "Community 101"
Cohesion: 0.20
Nodes (13): buildSparklineAreaPath(), buildSparklineLinePath(), computeSparklineDomain(), computeSparklineLayout(), curves, describeSparkline(), formatCompact(), isDefined() (+5 more)

### Community 102 - "Community 102"
Cohesion: 0.14
Nodes (13): aliases, components, utils, rsc, $schema, style, tailwind, baseColor (+5 more)

### Community 103 - "Community 103"
Cohesion: 0.14
Nodes (14): command, cpus, environment, image, mem_limit, memswap_limit, oom_score_adj, ports (+6 more)

### Community 104 - "Community 104"
Cohesion: 0.14
Nodes (13): HEAD_REF, jobs, source-must-be-dev, name, on, pull_request, branches, name (+5 more)

### Community 105 - "Community 105"
Cohesion: 0.15
Nodes (13): cmdk@^1.1.1, @radix-ui/react-dialog@^1.1.15, cmdk, @radix-ui/react-dialog, Command, CommandDialog(), CommandEmpty, CommandGroup (+5 more)

### Community 106 - "Community 106"
Cohesion: 0.18
Nodes (10): gsap@^3.15.0, next-themes@^0.4.6, gsap, next-themes, FlippingWordSwap(), FlippingWordSwapProps, segmentCharacters(), ThemeSwitchOverlay() (+2 more)

### Community 107 - "Community 107"
Cohesion: 0.25
Nodes (13): ChatChannelIllustration(), ChatInputIllustration(), ChatProgressIllustration(), ChatQuestionIllustration(), getChatGuideItems(), getVoiceGuideItems(), GuideItem, MicControlIllustration() (+5 more)

### Community 108 - "Community 108"
Cohesion: 0.24
Nodes (13): defaultFormFields(), defaultInterviewConfig(), deriveApplicationStatus(), applicationHasCv(), pickCvFile(), signApplicationCv(), configSchema, Ctx (+5 more)

### Community 109 - "Community 109"
Cohesion: 0.30
Nodes (11): analyzeHesitation(), ENDPOINTING_CONFIG, EndpointingConfig, decideEndpoint(), EndpointAction, EndpointDecision, EndpointDecisionInput, HesitationSignals (+3 more)

### Community 110 - "Community 110"
Cohesion: 0.15
Nodes (13): PGRST_DB_ANON_ROLE, PGRST_DB_MAX_ROWS, PGRST_DB_SCHEMAS, PGRST_DB_URI, PGRST_JWT_SECRET, cpus, environment, image (+5 more)

### Community 111 - "Community 111"
Cohesion: 0.15
Nodes (13): environment, healthcheck, image, ports, restart, volumes, POSTGRES_DB, POSTGRES_PASSWORD (+5 more)

### Community 112 - "Community 112"
Cohesion: 0.19
Nodes (8): clipRevealTransition(), DEFAULT_ANIMATION_DURATION_MS, DEFAULT_ANIMATION_EASING, DEFAULT_CHART_ENTER_TRANSITION, ChartRevealClip(), ChartRevealClipMode, ChartRevealClipProps, SpringOptions

### Community 113 - "Community 113"
Cohesion: 0.17
Nodes (11): concurrency, cancel-in-progress, group, env, APP_IMAGE, REGISTRY, VOICE_IMAGE, name (+3 more)

### Community 114 - "Community 114"
Cohesion: 0.23
Nodes (7): APP_CWD, delay(), RelayConnection, stopProcess(), waitForCondition(), waitForHttp(), waitForText()

### Community 115 - "Community 115"
Cohesion: 0.30
Nodes (12): armStaleAsrGuard(), bestAvailableTranscript(), cancelOngoingResponse(), clearSpeechFinalizeTimer(), commitUserTranscript(), finalizeUserTurn(), flushPendingUserTurnBeforeAssistant(), handleSpeechStartedEvent() (+4 more)

### Community 116 - "Community 116"
Cohesion: 0.27
Nodes (12): clearStaleAsrGuard(), emitInterimUserTranscript(), flushUserInput(), handleVolcFinalText(), handleVolcInterimText(), handleWhisperCompletedTranscript(), handleWhisperDelta(), noteTranscriptUpdate() (+4 more)

### Community 117 - "Community 117"
Cohesion: 0.30
Nodes (8): GlobalError(), NotFoundPage(), DEFAULT_SEARCH_TARGETS, Illustration(), NotFound(), onSearch(), resolveSearch(), NotFoundProps

### Community 118 - "Community 118"
Cohesion: 0.27
Nodes (4): FailoverProvider, isQuotaError(), modelFitsProvider(), shouldFailover()

### Community 119 - "Community 119"
Cohesion: 0.32
Nodes (10): loadAutoIncludePremade(), resolvePremadeQuestions(), enforceExactPremadeQuestions(), normalizeMatchText(), parseSkipIf(), PremadeExact, QuestionSkipIf, shouldSkipQuestion() (+2 more)

### Community 120 - "Community 120"
Cohesion: 0.24
Nodes (9): VoiceFunctionalPage(), VoiceFunctionalPageProps, FunctionalRelayEvent, FunctionalScenario, FunctionalScenarioId, functionalScenarios, installFunctionalRelayMocks(), VoiceFunctionalHarness() (+1 more)

### Community 121 - "Community 121"
Cohesion: 0.27
Nodes (11): BarPaths(), buildSparklineBarSegment(), buildSparklineBarsPath(), interpolateSparklineLayout(), sparklineBarWidth(), LineOrAreaPaths(), prefersReducedMotion(), sameShape() (+3 more)

### Community 122 - "Community 122"
Cohesion: 0.33
Nodes (9): DEFAULT_NAME_SET, getInterviewerPersona(), INTERVIEWER_GENDERS, INTERVIEWER_PERSONAS, InterviewerPersona, interviewerPromptIdentity(), isDefaultInterviewerName(), resolveGeminiVoice() (+1 more)

### Community 123 - "Community 123"
Cohesion: 0.20
Nodes (10): cpus, env_file, image, mem_limit, memswap_limit, oom_score_adj, ports, restart (+2 more)

### Community 124 - "Community 124"
Cohesion: 0.20
Nodes (10): voice, cpus, env_file, image, mem_limit, memswap_limit, oom_score_adj, ports (+2 more)

### Community 125 - "Community 125"
Cohesion: 0.24
Nodes (7): InterviewContext, Database, Enums, Insertable, Json, Tables, Updatable

### Community 126 - "Community 126"
Cohesion: 0.22
Nodes (9): depends_on, env_file, image, ports, restart, volumes, rest, condition (+1 more)

### Community 127 - "Community 127"
Cohesion: 0.22
Nodes (8): extends, rules, @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports, @typescript-eslint/no-unused-vars, @typescript-eslint/no-var-requires, next/core-web-vitals, plugin:@typescript-eslint/recommended

### Community 128 - "Community 128"
Cohesion: 0.22
Nodes (9): name, runs-on, steps, jobs, deploy, id, name, run (+1 more)

### Community 129 - "Community 129"
Cohesion: 0.14
Nodes (9): @radix-ui/react-tooltip@^1.2.8, @ricky0123/vad-web@^0.0.31, @trpc/next@^10.45.4, repository, type, url, @radix-ui/react-tooltip, @ricky0123/vad-web (+1 more)

### Community 130 - "Community 130"
Cohesion: 0.36
Nodes (4): GET(), assertSafeRemoteUrl(), isPrivateIp(), getFreePort()

### Community 131 - "Community 131"
Cohesion: 0.33
Nodes (7): isUserEndRequest(), isUserSkipRequest(), REPLY_INVITES_MORE_PATTERNS_EN, REPLY_INVITES_MORE_PATTERNS_ZH, responseInvitesUserReply(), USER_END_PATTERNS, USER_SKIP_PATTERNS

### Community 132 - "Community 132"
Cohesion: 0.39
Nodes (7): log, POST(), taskFromFollowUpDepth(), buildCandidateFocusSection(), hasCandidateFocus(), resolveProvider(), nextAskableQuestionIndex()

### Community 133 - "Community 133"
Cohesion: 0.25
Nodes (7): name, services, volumes, skillmark-dev-pg, skillmark-dev-storage, x-log, logging

### Community 134 - "Community 134"
Cohesion: 0.25
Nodes (8): depends_on, environment, image, ports, restart, volumes, SITE_ADDRESS, caddy

### Community 135 - "Community 135"
Cohesion: 0.36
Nodes (5): computeWebhookSignature(), log, verifyWebhookSignature(), WebhookEventName, WebhookPayload

### Community 136 - "Community 136"
Cohesion: 0.39
Nodes (5): log, POST(), assertActiveInterviewSession(), SessionAccessResult, TENANT_COPY

### Community 137 - "Community 137"
Cohesion: 0.46
Nodes (7): collectChartDefsChildren(), getChartChildComponentName(), isChartDefsComponent(), isGradientDefComponent(), isPatternDefComponent(), partitionChartDefNodes(), VISX_PATTERN_COMPONENT_NAMES

### Community 138 - "Community 138"
Cohesion: 0.25
Nodes (5): AuthError, AuthUser, client, Listener, listeners

### Community 139 - "Community 139"
Cohesion: 0.29
Nodes (7): logging, logging, options, max-file, max-size, logging, logging

### Community 140 - "Community 140"
Cohesion: 0.29
Nodes (6): name, services, voice, env_file, image, restart

### Community 141 - "Community 141"
Cohesion: 0.29
Nodes (7): condition, db, depends_on, image, ports, restart, rest

### Community 142 - "Community 142"
Cohesion: 0.29
Nodes (4): @excalidraw/excalidraw@^0.18.0, @excalidraw/excalidraw, ExcalidrawAPI, WhiteboardCanvasProps

### Community 143 - "Community 143"
Cohesion: 0.33
Nodes (4): outDir, pcmToWav(), synthesize(), texts

### Community 144 - "Community 144"
Cohesion: 0.52
Nodes (4): handler(), serverTrpc(), createContext(), appRouter

### Community 145 - "Community 145"
Cohesion: 0.38
Nodes (6): ChartParentSizeProps, ElementSize, readElementSize(), useElementSize(), useIsomorphicLayoutEffect, ZERO_SIZE

### Community 146 - "Community 146"
Cohesion: 0.33
Nodes (6): depends_on, condition, db, rest, condition, depends_on

### Community 147 - "Community 147"
Cohesion: 0.33
Nodes (6): environment, HOSTNAME, NODE_ENV, PORT, POSTGREST_URL, STORAGE_DIR

### Community 148 - "Community 148"
Cohesion: 0.33
Nodes (6): healthcheck, interval, retries, start_period, test, timeout

### Community 149 - "Community 149"
Cohesion: 0.33
Nodes (6): GEMINI_VOICE_RELAY_PORT, OPENAI_VOICE_RELAY_PORT, VOICE_RELAY_HOST, VOICE_RELAY_PORT, VOICE_RELAY_PROVIDER, environment

### Community 150 - "Community 150"
Cohesion: 0.33
Nodes (6): environment, HOSTNAME, NODE_ENV, PORT, POSTGREST_URL, STORAGE_DIR

### Community 151 - "Community 151"
Cohesion: 0.33
Nodes (6): GEMINI_VOICE_RELAY_PORT, OPENAI_VOICE_RELAY_PORT, VOICE_RELAY_HOST, VOICE_RELAY_PORT, VOICE_RELAY_PROVIDER, environment

### Community 152 - "Community 152"
Cohesion: 0.33
Nodes (6): PGRST_DB_ANON_ROLE, PGRST_DB_MAX_ROWS, PGRST_DB_SCHEMAS, PGRST_DB_URI, PGRST_JWT_SECRET, environment

### Community 153 - "Community 153"
Cohesion: 0.33
Nodes (5): tailwindcss-animate@^1.0.7, tailwindcss@^3.4.1, tailwindcss, tailwindcss-animate, config

### Community 154 - "Community 154"
Cohesion: 0.33
Nodes (5): GEMINI_VOICE_RELAY_PORT, OPENAI_VOICE_RELAY_PORT, voice-entrypoint.sh script, VOICE_RELAY_HOST, VOICE_RELAY_PORT

### Community 155 - "Community 155"
Cohesion: 0.73
Nodes (6): findRecentVoiceTranscriptMatch(), findTrailingVoiceDuplicateCluster(), isBriefStandaloneVoiceUtterance(), isExpandedTranscript(), normalizeTranscript(), upsertFinalVoiceTranscript()

### Community 156 - "Community 156"
Cohesion: 0.40
Nodes (6): AreaSparklineImpl(), BarSparklineImpl(), resolveSparklinePadding(), LineOrArea(), LineSparklineImpl(), resolveHoverSpring()

### Community 157 - "Community 157"
Cohesion: 0.40
Nodes (6): HoverMarks(), HoverMarksView(), HoverOverlay(), SparklineCrosshairLine(), SparklineDot(), SpringHoverMarks()

### Community 158 - "Community 158"
Cohesion: 0.47
Nodes (4): INTERVIEW_TEMPLATES, InterviewTemplate, TemplateQuestion, QUESTION_TYPES

### Community 159 - "Community 159"
Cohesion: 0.47
Nodes (4): averageScore(), ScoreEntry, SessionScoreInsights, usesQuestionEvaluationScore()

### Community 160 - "Community 160"
Cohesion: 0.60
Nodes (4): latestTimestamp(), RANGE_MS, startOfToday(), timeRangeCutoff()

### Community 161 - "Community 161"
Cohesion: 0.40
Nodes (5): volumes, caddy-config, caddy-data, skillmark-pg, skillmark-storage

### Community 162 - "Community 162"
Cohesion: 0.50
Nodes (4): on, push, workflow_dispatch, branches

### Community 163 - "Community 163"
Cohesion: 0.50
Nodes (3): onnxruntime-web@^1.31.1, onnxruntime-web, onnxruntime-web/wasm

### Community 165 - "Community 165"
Cohesion: 0.67
Nodes (3): GtagEvent, trackCtaClick(), trackEvent()

## Knowledge Gaps
- **21 isolated node(s):** `next/core-web-vitals`, `plugin:@typescript-eslint/recommended`, `GEMINI_VOICE_RELAY_PORT`, `OPENAI_VOICE_RELAY_PORT`, `VOICE_RELAY_HOST` (+16 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 1381 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react` connect `Community 1` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 7`, `Community 137`, `Community 11`, `Community 12`, `Community 13`, `Community 142`, `Community 15`, `Community 145`, `Community 17`, `Community 19`, `Community 23`, `Community 24`, `Community 26`, `Community 29`, `Community 30`, `Community 31`, `Community 34`, `Community 164`, `Community 40`, `Community 43`, `Community 44`, `Community 46`, `Community 47`, `Community 53`, `Community 56`, `Community 68`, `Community 69`, `Community 71`, `Community 73`, `Community 75`, `Community 76`, `Community 84`, `Community 85`, `Community 86`, `Community 91`, `Community 93`, `Community 94`, `Community 99`, `Community 100`, `Community 105`, `Community 106`, `Community 117`, `Community 120`?**
  _High betweenness centrality (0.140) - this node is a cross-community bridge._
- **What connects `next/core-web-vitals`, `plugin:@typescript-eslint/recommended`, `GEMINI_VOICE_RELAY_PORT` to the rest of the system?**
  _21 weakly-connected nodes found - possible missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.03873744619799139 - nodes in this community are weakly interconnected._
- **Why does `next` connect `Community 8` to `Community 0`, `Community 1`, `Community 2`, `Community 130`, `Community 132`, `Community 4`, `Community 6`, `Community 5`, `Community 136`, `Community 3`, `Community 10`, `Community 11`, `Community 7`, `Community 14`, `Community 15`, `Community 26`, `Community 28`, `Community 31`, `Community 32`, `Community 33`, `Community 43`, `Community 47`, `Community 48`, `Community 50`, `Community 53`, `Community 65`, `Community 72`, `Community 75`, `Community 86`, `Community 98`, `Community 99`, `Community 117`, `Community 120`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05764944275582574 - nodes in this community are weakly interconnected._
- **Why does `cn()` connect `Community 7` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 12`, `Community 13`, `Community 19`, `Community 24`, `Community 26`, `Community 29`, `Community 30`, `Community 31`, `Community 34`, `Community 44`, `Community 56`, `Community 68`, `Community 69`, `Community 73`, `Community 75`, `Community 85`, `Community 91`, `Community 93`, `Community 94`, `Community 99`, `Community 101`, `Community 105`, `Community 106`, `Community 107`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05337004982953055 - nodes in this community are weakly interconnected._