-- Skillmark public schema (generated from the original supabase/migrations 001-003).
--
-- PostgreSQL database dump
--

\restrict Oj7ap5QB9HT9wYoaMmIRgioyIciJKtO6iEmCQaLwMSU38OmhtbwS10hx5SOLDE4

-- Dumped from database version 16.15 (Debian 16.15-1.pgdg13+2)
-- Dumped by pg_dump version 16.15 (Debian 16.15-1.pgdg13+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: ContentType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ContentType" AS ENUM (
    'TEXT',
    'AUDIO',
    'FILE',
    'IMAGE',
    'WHITEBOARD',
    'CODE'
);


--
-- Name: FollowUpDepth; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."FollowUpDepth" AS ENUM (
    'LIGHT',
    'MODERATE',
    'DEEP'
);


--
-- Name: InterviewMode; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."InterviewMode" AS ENUM (
    'CHAT',
    'VOICE',
    'HYBRID'
);


--
-- Name: MemberRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MemberRole" AS ENUM (
    'OWNER',
    'ADMIN',
    'MEMBER',
    'VIEWER'
);


--
-- Name: MessageRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."MessageRole" AS ENUM (
    'USER',
    'ASSISTANT',
    'SYSTEM'
);


--
-- Name: QuestionType; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."QuestionType" AS ENUM (
    'OPEN_ENDED',
    'SINGLE_CHOICE',
    'MULTIPLE_CHOICE',
    'CODING',
    'WHITEBOARD',
    'RESEARCH'
);


--
-- Name: SessionStatus; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."SessionStatus" AS ENUM (
    'IN_PROGRESS',
    'COMPLETED',
    'ABANDONED'
);


--
-- Name: ToneLevel; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."ToneLevel" AS ENUM (
    'CASUAL',
    'PROFESSIONAL',
    'FORMAL',
    'FRIENDLY'
);


--
-- Name: UserRole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public."UserRole" AS ENUM (
    'USER',
    'ADMIN',
    'ENTERPRISE'
);


--
-- Name: create_interview_session(uuid, text, text, public."InterviewMode", uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_interview_session(p_interview_id uuid, p_participant_name text DEFAULT NULL::text, p_participant_email text DEFAULT NULL::text, p_mode_used public."InterviewMode" DEFAULT 'CHAT'::public."InterviewMode", p_current_question_id uuid DEFAULT NULL::uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_session sessions;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM interviews
    WHERE id = p_interview_id
      AND "publicSlug" IS NOT NULL
      AND "isActive" = true
  ) THEN
    RAISE EXCEPTION 'Interview not found or inactive';
  END IF;

  INSERT INTO sessions ("interviewId", "participantName", "participantEmail", "modeUsed", "currentQuestionId")
  VALUES (p_interview_id, p_participant_name, p_participant_email, p_mode_used, p_current_question_id)
  RETURNING * INTO v_session;

  RETURN row_to_json(v_session);
END;
$$;


--
-- Name: create_invite_session(text, public."InterviewMode", uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_invite_session(p_invite_token text, p_mode_used public."InterviewMode" DEFAULT 'CHAT'::public."InterviewMode", p_current_question_id uuid DEFAULT NULL::uuid) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_candidate candidates;
  v_interview interviews;
  v_session   sessions;
BEGIN
  SELECT * INTO v_candidate FROM candidates WHERE "inviteToken" = p_invite_token;
  IF v_candidate IS NULL THEN
    RAISE EXCEPTION 'Invalid invite token';
  END IF;

  IF v_candidate."sessionId" IS NOT NULL THEN
    SELECT * INTO v_session FROM sessions WHERE id = v_candidate."sessionId";
    RETURN row_to_json(v_session);
  END IF;

  SELECT * INTO v_interview FROM interviews WHERE id = v_candidate."interviewId";
  IF v_interview IS NULL THEN
    RAISE EXCEPTION 'Interview not found';
  END IF;

  INSERT INTO sessions ("interviewId", "participantName", "participantEmail", "modeUsed", "currentQuestionId")
  VALUES (v_interview.id, v_candidate.name, v_candidate.email, coalesce(p_mode_used, v_interview.mode), p_current_question_id)
  RETURNING * INTO v_session;

  UPDATE candidates SET "sessionId" = v_session.id, "updatedAt" = now() WHERE id = v_candidate.id;

  RETURN row_to_json(v_session);
END;
$$;


--
-- Name: create_organization(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.create_organization(org_name text, org_slug text) RETURNS json
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_org     record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO organizations (name, slug, "ownerId")
  VALUES (org_name, org_slug, v_user_id)
  RETURNING * INTO v_org;

  INSERT INTO organization_members ("workspaceId", "userId", role)
  VALUES (v_org.id, v_user_id, 'OWNER');

  RETURN json_build_object(
    'id', v_org.id,
    'name', v_org.name,
    'slug', v_org.slug,
    'ownerId', v_org."ownerId"
  );
END;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name, avatar)
  VALUES (
    NEW.id,
    NEW.email,
    coalesce(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    name   = coalesce(excluded.name, profiles.name),
    avatar = coalesce(excluded.avatar, profiles.avatar);

  RETURN NEW;
END;
$$;


--
-- Name: is_org_member(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_org_member(org_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM organization_members
    WHERE "workspaceId" = org_id
      AND "userId" = auth.uid()
  );
$$;


--
-- Name: update_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW."updatedAt" = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "userId" uuid NOT NULL,
    name text NOT NULL,
    key text NOT NULL,
    "lastUsedAt" timestamp with time zone,
    "expiresAt" timestamp with time zone,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "userId" uuid,
    action text NOT NULL,
    "resourceType" text NOT NULL,
    "resourceId" text,
    metadata jsonb,
    "ipAddress" text,
    "userAgent" text,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "interviewId" uuid NOT NULL,
    name text NOT NULL,
    email text,
    phone text,
    gender text,
    birthday text,
    notes text,
    education text,
    school text,
    major text,
    "graduationYear" integer,
    "workExperience" text,
    "inviteToken" text,
    "sessionId" uuid,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: interviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.interviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    objective text,
    "assessmentCriteria" jsonb,
    mode public."InterviewMode" DEFAULT 'CHAT'::public."InterviewMode" NOT NULL,
    "allowModeSwitch" boolean DEFAULT true NOT NULL,
    "userId" uuid NOT NULL,
    "projectId" uuid,
    "aiPersona" text,
    "aiName" text DEFAULT 'Aural'::text NOT NULL,
    "aiTone" public."ToneLevel" DEFAULT 'PROFESSIONAL'::public."ToneLevel" NOT NULL,
    "followUpDepth" public."FollowUpDepth" DEFAULT 'MODERATE'::public."FollowUpDepth" NOT NULL,
    language text DEFAULT 'en'::text NOT NULL,
    "llmProvider" text,
    "llmModel" text,
    "isActive" boolean DEFAULT true NOT NULL,
    "timeLimitMinutes" integer,
    "customBranding" jsonb,
    "publicSlug" text,
    "requireInvite" boolean DEFAULT false NOT NULL,
    "invitedEmails" text[] DEFAULT '{}'::text[] NOT NULL,
    "videoMode" boolean DEFAULT false NOT NULL,
    "chatEnabled" boolean DEFAULT true NOT NULL,
    "voiceEnabled" boolean DEFAULT false NOT NULL,
    "videoEnabled" boolean DEFAULT false NOT NULL,
    "antiCheatingEnabled" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "sessionId" uuid NOT NULL,
    role public."MessageRole" NOT NULL,
    content text NOT NULL,
    "contentType" public."ContentType" DEFAULT 'TEXT'::public."ContentType" NOT NULL,
    "audioUrl" text,
    "audioDurationSeconds" integer,
    transcription text,
    "whiteboardData" jsonb,
    "whiteboardImageUrl" text,
    "whiteboardPages" integer DEFAULT 1 NOT NULL,
    "questionId" uuid,
    "isFollowUp" boolean DEFAULT false NOT NULL,
    "parentMessageId" uuid,
    sentiment text,
    "wordCount" integer,
    "readingTimeSeconds" integer,
    "timestamp" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "workspaceId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    role public."MemberRole" DEFAULT 'MEMBER'::public."MemberRole" NOT NULL,
    "joinedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    "ownerId" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text NOT NULL,
    name text,
    avatar text,
    organization text,
    role public."UserRole" DEFAULT 'USER'::public."UserRole" NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: project_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.project_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "projectId" uuid NOT NULL,
    "userId" uuid NOT NULL,
    role public."MemberRole" DEFAULT 'MEMBER'::public."MemberRole" NOT NULL,
    "assignedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "organizationId" uuid NOT NULL,
    name text NOT NULL,
    description text,
    "createdBy" uuid NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: questions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "interviewId" uuid NOT NULL,
    "order" integer NOT NULL,
    text text NOT NULL,
    description text,
    type public."QuestionType" NOT NULL,
    options jsonb,
    "starterCode" jsonb,
    "validationRules" jsonb,
    "followUpPrompts" jsonb,
    "probeOnShort" boolean DEFAULT true NOT NULL,
    "probeThreshold" integer,
    "showIf" jsonb,
    "skipIf" jsonb,
    "timeLimitSeconds" integer,
    "isRequired" boolean DEFAULT true NOT NULL,
    "allowFileUpload" boolean DEFAULT false NOT NULL,
    "allowedFileTypes" text[] DEFAULT '{}'::text[] NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "interviewId" uuid NOT NULL,
    "participantEmail" text,
    "participantName" text,
    "participantPhone" text,
    "participantMetadata" jsonb,
    status public."SessionStatus" DEFAULT 'IN_PROGRESS'::public."SessionStatus" NOT NULL,
    "currentQuestionId" uuid,
    "modeUsed" public."InterviewMode" DEFAULT 'CHAT'::public."InterviewMode" NOT NULL,
    "modeSwitches" integer DEFAULT 0 NOT NULL,
    summary text,
    insights jsonb,
    themes text[] DEFAULT '{}'::text[] NOT NULL,
    sentiment jsonb,
    "startedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "completedAt" timestamp with time zone,
    "lastActivityAt" timestamp with time zone DEFAULT now() NOT NULL,
    "totalDurationSeconds" integer,
    "audioRecordingUrl" text,
    screenshots jsonb,
    "audioDuration" real,
    "antiCheatingLog" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
    "activitySegments" jsonb DEFAULT '[]'::jsonb NOT NULL,
    "audioRecordings" jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: support_tickets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_tickets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    email text,
    type text DEFAULT 'Question'::text NOT NULL,
    severity text,
    topic text,
    message text NOT NULL,
    attachments jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: webhooks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    "userId" uuid NOT NULL,
    url text NOT NULL,
    events text[] DEFAULT '{}'::text[] NOT NULL,
    secret text,
    "isActive" boolean DEFAULT true NOT NULL,
    "createdAt" timestamp with time zone DEFAULT now() NOT NULL,
    "updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: api_keys api_keys_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_key UNIQUE (key);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: candidates candidates_inviteToken_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT "candidates_inviteToken_key" UNIQUE ("inviteToken");


--
-- Name: candidates candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT candidates_pkey PRIMARY KEY (id);


--
-- Name: interviews interviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT interviews_pkey PRIMARY KEY (id);


--
-- Name: interviews interviews_publicSlug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT "interviews_publicSlug_key" UNIQUE ("publicSlug");


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (id);


--
-- Name: organization_members organization_members_workspaceId_userId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT "organization_members_workspaceId_userId_key" UNIQUE ("workspaceId", "userId");


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: profiles profiles_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_email_key UNIQUE (email);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: project_members project_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT project_members_pkey PRIMARY KEY (id);


--
-- Name: project_members project_members_projectId_userId_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT "project_members_projectId_userId_key" UNIQUE ("projectId", "userId");


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);


--
-- Name: questions questions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT questions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: support_tickets support_tickets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_pkey PRIMARY KEY (id);


--
-- Name: webhooks webhooks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);


--
-- Name: idx_api_keys_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_api_keys_user ON public.api_keys USING btree ("userId");


--
-- Name: idx_audit_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user ON public.audit_logs USING btree ("userId");


--
-- Name: idx_candidates_interview_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidates_interview_id ON public.candidates USING btree ("interviewId");


--
-- Name: idx_candidates_invite_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidates_invite_token ON public.candidates USING btree ("inviteToken") WHERE ("inviteToken" IS NOT NULL);


--
-- Name: idx_candidates_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_candidates_session_id ON public.candidates USING btree ("sessionId");


--
-- Name: idx_interviews_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interviews_organization ON public.interviews USING btree ("projectId");


--
-- Name: idx_interviews_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interviews_project ON public.interviews USING btree ("projectId");


--
-- Name: idx_interviews_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_interviews_user ON public.interviews USING btree ("userId");


--
-- Name: idx_messages_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_messages_session ON public.messages USING btree ("sessionId");


--
-- Name: idx_organization_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organization_members_user ON public.organization_members USING btree ("userId");


--
-- Name: idx_project_members_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_members_project ON public.project_members USING btree ("projectId");


--
-- Name: idx_project_members_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_project_members_user ON public.project_members USING btree ("userId");


--
-- Name: idx_projects_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_created_by ON public.projects USING btree ("createdBy");


--
-- Name: idx_projects_organization; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_projects_organization ON public.projects USING btree ("organizationId");


--
-- Name: idx_questions_interview; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_questions_interview ON public.questions USING btree ("interviewId");


--
-- Name: idx_sessions_interview; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sessions_interview ON public.sessions USING btree ("interviewId");


--
-- Name: idx_webhooks_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_webhooks_user ON public.webhooks USING btree ("userId");


--
-- Name: interviews set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.interviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: organizations set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: profiles set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: projects set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: questions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.questions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: sessions set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: webhooks set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.webhooks FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


--
-- Name: api_keys api_keys_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT "api_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: candidates candidates_interviewId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT "candidates_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES public.interviews(id) ON DELETE CASCADE;


--
-- Name: candidates candidates_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.candidates
    ADD CONSTRAINT "candidates_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public.sessions(id) ON DELETE SET NULL;


--
-- Name: interviews interviews_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT "interviews_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public.projects(id) ON DELETE SET NULL;


--
-- Name: interviews interviews_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.interviews
    ADD CONSTRAINT "interviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES auth.users(id);


--
-- Name: messages messages_sessionId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT "messages_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_workspaceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT "organization_members_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_projectId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT "project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES public.projects(id) ON DELETE CASCADE;


--
-- Name: project_members project_members_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.project_members
    ADD CONSTRAINT "project_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: projects projects_createdBy_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT "projects_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES auth.users(id);


--
-- Name: projects projects_organizationId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.projects
    ADD CONSTRAINT "projects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: questions questions_interviewId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.questions
    ADD CONSTRAINT "questions_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES public.interviews(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_interviewId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT "sessions_interviewId_fkey" FOREIGN KEY ("interviewId") REFERENCES public.interviews(id) ON DELETE CASCADE;


--
-- Name: support_tickets support_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_tickets
    ADD CONSTRAINT support_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: webhooks webhooks_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT "webhooks_userId_fkey" FOREIGN KEY ("userId") REFERENCES auth.users(id);


--
-- Name: sessions Anyone can create sessions for public interviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can create sessions for public interviews" ON public.sessions FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.interviews
  WHERE ((interviews.id = sessions."interviewId") AND (interviews."publicSlug" IS NOT NULL) AND (interviews."isActive" = true)))));


--
-- Name: messages Anyone can insert messages into active sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Anyone can insert messages into active sessions" ON public.messages FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.sessions
  WHERE ((sessions.id = messages."sessionId") AND (sessions.status = 'IN_PROGRESS'::public."SessionStatus")))));


--
-- Name: candidates Candidates readable by owner or invite token; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Candidates readable by owner or invite token" ON public.candidates FOR SELECT USING ((("inviteToken" IS NOT NULL) OR (EXISTS ( SELECT 1
   FROM public.interviews
  WHERE ((interviews.id = candidates."interviewId") AND (interviews."userId" = ( SELECT auth.uid() AS uid)))))));


--
-- Name: candidates Interview owners can delete candidates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Interview owners can delete candidates" ON public.candidates FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.interviews
  WHERE ((interviews.id = candidates."interviewId") AND (interviews."userId" = ( SELECT auth.uid() AS uid))))));


--
-- Name: questions Interview owners can delete questions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Interview owners can delete questions" ON public.questions FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.interviews
  WHERE ((interviews.id = questions."interviewId") AND (interviews."userId" = ( SELECT auth.uid() AS uid))))));


--
-- Name: candidates Interview owners can insert candidates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Interview owners can insert candidates" ON public.candidates FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.interviews
  WHERE ((interviews.id = candidates."interviewId") AND (interviews."userId" = ( SELECT auth.uid() AS uid))))));


--
-- Name: questions Interview owners can insert questions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Interview owners can insert questions" ON public.questions FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.interviews
  WHERE ((interviews.id = questions."interviewId") AND (interviews."userId" = ( SELECT auth.uid() AS uid))))));


--
-- Name: messages Interview owners can read messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Interview owners can read messages" ON public.messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.sessions
     JOIN public.interviews ON ((interviews.id = sessions."interviewId")))
  WHERE ((sessions.id = messages."sessionId") AND (interviews."userId" = ( SELECT auth.uid() AS uid))))));


--
-- Name: sessions Interview owners can read sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Interview owners can read sessions" ON public.sessions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.interviews
  WHERE ((interviews.id = sessions."interviewId") AND (interviews."userId" = ( SELECT auth.uid() AS uid))))));


--
-- Name: candidates Interview owners can update candidates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Interview owners can update candidates" ON public.candidates FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.interviews
  WHERE ((interviews.id = candidates."interviewId") AND (interviews."userId" = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.interviews
  WHERE ((interviews.id = candidates."interviewId") AND (interviews."userId" = ( SELECT auth.uid() AS uid))))));


--
-- Name: questions Interview owners can update questions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Interview owners can update questions" ON public.questions FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.interviews
  WHERE ((interviews.id = questions."interviewId") AND (interviews."userId" = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.interviews
  WHERE ((interviews.id = questions."interviewId") AND (interviews."userId" = ( SELECT auth.uid() AS uid))))));


--
-- Name: interviews Interviews readable by owner or public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Interviews readable by owner or public" ON public.interviews FOR SELECT USING ((("userId" = ( SELECT auth.uid() AS uid)) OR (("publicSlug" IS NOT NULL) AND ("isActive" = true))));


--
-- Name: organization_members Members can read org members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Members can read org members" ON public.organization_members FOR SELECT USING ((("userId" = ( SELECT auth.uid() AS uid)) OR public.is_org_member("workspaceId")));


--
-- Name: projects Org admins can delete projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org admins can delete projects" ON public.projects FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.organization_members
  WHERE ((organization_members."workspaceId" = projects."organizationId") AND (organization_members."userId" = ( SELECT auth.uid() AS uid)) AND (organization_members.role = ANY (ARRAY['OWNER'::public."MemberRole", 'ADMIN'::public."MemberRole"]))))));


--
-- Name: projects Org admins can insert projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org admins can insert projects" ON public.projects FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_members
  WHERE ((organization_members."workspaceId" = projects."organizationId") AND (organization_members."userId" = ( SELECT auth.uid() AS uid)) AND (organization_members.role = ANY (ARRAY['OWNER'::public."MemberRole", 'ADMIN'::public."MemberRole"]))))));


--
-- Name: project_members Org admins can manage project members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org admins can manage project members" ON public.project_members USING ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.organization_members om ON ((om."workspaceId" = p."organizationId")))
  WHERE ((p.id = project_members."projectId") AND (om."userId" = ( SELECT auth.uid() AS uid)) AND (om.role = ANY (ARRAY['OWNER'::public."MemberRole", 'ADMIN'::public."MemberRole"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.organization_members om ON ((om."workspaceId" = p."organizationId")))
  WHERE ((p.id = project_members."projectId") AND (om."userId" = ( SELECT auth.uid() AS uid)) AND (om.role = ANY (ARRAY['OWNER'::public."MemberRole", 'ADMIN'::public."MemberRole"]))))));


--
-- Name: projects Org admins can update projects; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org admins can update projects" ON public.projects FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.organization_members
  WHERE ((organization_members."workspaceId" = projects."organizationId") AND (organization_members."userId" = ( SELECT auth.uid() AS uid)) AND (organization_members.role = ANY (ARRAY['OWNER'::public."MemberRole", 'ADMIN'::public."MemberRole"])))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organization_members
  WHERE ((organization_members."workspaceId" = projects."organizationId") AND (organization_members."userId" = ( SELECT auth.uid() AS uid)) AND (organization_members.role = ANY (ARRAY['OWNER'::public."MemberRole", 'ADMIN'::public."MemberRole"]))))));


--
-- Name: project_members Org members can read project members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org members can read project members" ON public.project_members FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.projects p
     JOIN public.organization_members om ON ((om."workspaceId" = p."organizationId")))
  WHERE ((p.id = project_members."projectId") AND (om."userId" = ( SELECT auth.uid() AS uid))))));


--
-- Name: organization_members Org owners can delete members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org owners can delete members" ON public.organization_members FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.organizations
  WHERE ((organizations.id = organization_members."workspaceId") AND (organizations."ownerId" = ( SELECT auth.uid() AS uid))))));


--
-- Name: organization_members Org owners can insert members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org owners can insert members" ON public.organization_members FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.organizations
  WHERE ((organizations.id = organization_members."workspaceId") AND (organizations."ownerId" = ( SELECT auth.uid() AS uid))))));


--
-- Name: organization_members Org owners can update members; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org owners can update members" ON public.organization_members FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM public.organizations
  WHERE ((organizations.id = organization_members."workspaceId") AND (organizations."ownerId" = ( SELECT auth.uid() AS uid))))));


--
-- Name: organizations Org readable by member or owner; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Org readable by member or owner" ON public.organizations FOR SELECT USING ((("ownerId" = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.organization_members
  WHERE ((organization_members."workspaceId" = organizations.id) AND (organization_members."userId" = ( SELECT auth.uid() AS uid)))))));


--
-- Name: organizations Owners can delete organizations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can delete organizations" ON public.organizations FOR DELETE USING (("ownerId" = ( SELECT auth.uid() AS uid)));


--
-- Name: interviews Owners can delete own interviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can delete own interviews" ON public.interviews FOR DELETE USING (("userId" = ( SELECT auth.uid() AS uid)));


--
-- Name: organizations Owners can insert organizations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can insert organizations" ON public.organizations FOR INSERT WITH CHECK (("ownerId" = ( SELECT auth.uid() AS uid)));


--
-- Name: interviews Owners can insert own interviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can insert own interviews" ON public.interviews FOR INSERT WITH CHECK (("userId" = ( SELECT auth.uid() AS uid)));


--
-- Name: organizations Owners can update organizations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can update organizations" ON public.organizations FOR UPDATE USING (("ownerId" = ( SELECT auth.uid() AS uid))) WITH CHECK (("ownerId" = ( SELECT auth.uid() AS uid)));


--
-- Name: interviews Owners can update own interviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Owners can update own interviews" ON public.interviews FOR UPDATE USING (("userId" = ( SELECT auth.uid() AS uid))) WITH CHECK (("userId" = ( SELECT auth.uid() AS uid)));


--
-- Name: projects Projects readable by org member or admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Projects readable by org member or admin" ON public.projects FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members
  WHERE ((organization_members."workspaceId" = projects."organizationId") AND (organization_members."userId" = ( SELECT auth.uid() AS uid))))));


--
-- Name: questions Questions readable by owner or public interview; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Questions readable by owner or public interview" ON public.questions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.interviews
  WHERE ((interviews.id = questions."interviewId") AND ((interviews."userId" = ( SELECT auth.uid() AS uid)) OR ((interviews."publicSlug" IS NOT NULL) AND (interviews."isActive" = true)))))));


--
-- Name: sessions Session participants can update own session; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Session participants can update own session" ON public.sessions FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: support_tickets Users can create their own tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can create their own tickets" ON public.support_tickets FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: api_keys Users can delete own API keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own API keys" ON public.api_keys FOR DELETE USING (("userId" = ( SELECT auth.uid() AS uid)));


--
-- Name: webhooks Users can delete own webhooks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can delete own webhooks" ON public.webhooks FOR DELETE USING (("userId" = ( SELECT auth.uid() AS uid)));


--
-- Name: api_keys Users can insert own API keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own API keys" ON public.api_keys FOR INSERT WITH CHECK (("userId" = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles Users can insert own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: webhooks Users can insert own webhooks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own webhooks" ON public.webhooks FOR INSERT WITH CHECK (("userId" = ( SELECT auth.uid() AS uid)));


--
-- Name: api_keys Users can read own API keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own API keys" ON public.api_keys FOR SELECT USING (("userId" = ( SELECT auth.uid() AS uid)));


--
-- Name: audit_logs Users can read own audit logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own audit logs" ON public.audit_logs FOR SELECT USING (("userId" = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles Users can read own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: webhooks Users can read own webhooks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own webhooks" ON public.webhooks FOR SELECT USING (("userId" = ( SELECT auth.uid() AS uid)));


--
-- Name: api_keys Users can update own API keys; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own API keys" ON public.api_keys FOR UPDATE USING (("userId" = ( SELECT auth.uid() AS uid))) WITH CHECK (("userId" = ( SELECT auth.uid() AS uid)));


--
-- Name: profiles Users can update own profile; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING ((id = ( SELECT auth.uid() AS uid))) WITH CHECK ((id = ( SELECT auth.uid() AS uid)));


--
-- Name: webhooks Users can update own webhooks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can update own webhooks" ON public.webhooks FOR UPDATE USING (("userId" = ( SELECT auth.uid() AS uid))) WITH CHECK (("userId" = ( SELECT auth.uid() AS uid)));


--
-- Name: support_tickets Users can view their own tickets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can view their own tickets" ON public.support_tickets FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: api_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: interviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.interviews ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: project_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

--
-- Name: questions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: support_tickets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

--
-- Name: webhooks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--

\unrestrict Oj7ap5QB9HT9wYoaMmIRgioyIciJKtO6iEmCQaLwMSU38OmhtbwS10hx5SOLDE4


CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
