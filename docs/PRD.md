# BizPilot AI — Product Requirements Document

**Document owner:** Chief Product Officer
**Product:** BizPilot AI — the AI co-pilot for running a small business
**Status:** v1.0 — Foundational PRD (pre-build)

---

## 1. Vision

A small business should be able to compete with companies ten times its size — not by hiring ten times the people, but by giving every founder and operator an AI co-pilot that runs marketing, sales, support, content, and analytics alongside them. BizPilot AI exists to make one person, or one small team, operationally as capable as a full department, by putting AI at the center of every business workflow instead of bolting it onto the side of one.

## 2. Mission

BizPilot AI unifies the tools a small business needs to acquire, serve, and grow its customers — marketing, sales, support, content, and analytics — into a single AI-native workspace, so business owners spend their time on decisions and relationships instead of switching between six disconnected apps and doing the busywork themselves.

## 3. Target Users

| Segment | Description |
|---|---|
| **Solopreneurs & freelancers** | One-person businesses (consultants, coaches, creators) who must personally cover marketing, sales, and support. |
| **Small businesses (2–50 employees)** | Owner-operated companies without dedicated marketing/sales/support departments — the primary market. |
| **Growing startups** | Post-product-market-fit teams that need to scale go-to-market motion without scaling headcount at the same rate. |
| **Marketing & creative agencies** | Firms managing marketing/content/support on behalf of multiple client businesses from one tool (multi-workspace usage). |
| **Internal ops/marketing hires at SMBs** | The first dedicated marketing, sales, or support hire at a small company, who needs leverage more than headcount. |

## 4. User Personas

### Persona 1 — "Solo Sam," the Solopreneur
- **Role:** Independent consultant / course creator, one-person business.
- **Team:** Just themself; occasionally a part-time VA.
- **Goals:** Stay visible on social/email, close inbound leads, answer customer questions fast, without hiring anyone.
- **Frustrations:** No time or skill for copywriting/design; can't afford a marketing agency or CRM + helpdesk + email tool stack; context-switches all day.
- **How BizPilot AI helps:** One workspace generates their content, drafts their outreach, tracks their few leads, and answers routine customer emails — Sam approves instead of authors.

### Persona 2 — "Owner Olivia," the Small Business Owner/Operator
- **Role:** Owner of a 8-person local/regional service business (e.g., a boutique agency, clinic, or specialty retailer).
- **Team:** A handful of generalists; nobody owns marketing or support full-time.
- **Goals:** Consistent lead flow, faster customer response times, visibility into what's actually working, without adding payroll.
- **Frustrations:** Marketing is the first thing that gets dropped when things get busy; support tickets pile up; no real reporting, just gut feel.
- **How BizPilot AI helps:** Gives the team a shared workspace with AI doing the first draft of everything, plus a dashboard that finally answers "is this working?"

### Persona 3 — "Marketer Maya," the First Marketing Hire
- **Role:** Sole marketing/growth hire at a 20–50 person startup.
- **Team:** Reports to the founder/CEO; no team of her own yet.
- **Goals:** Ship more campaigns than one person should be able to, prove ROI quickly, build a repeatable content engine.
- **Frustrations:** Expected to be a full department; approval bottlenecks; disconnected point tools (separate social scheduler, email tool, analytics, doc for copy).
- **How BizPilot AI helps:** AI drafts and repurposes content at volume, a shared prompt library and templates keep output consistent, and analytics ties campaigns to pipeline without manual spreadsheet work.

### Persona 4 — "Agency Alex," the Agency Owner
- **Role:** Runs a small marketing/content agency serving 5–15 SMB clients.
- **Team:** 3–10 people, working across many client accounts simultaneously.
- **Goals:** Deliver consistent, on-brand output per client fast enough to stay profitable at SMB retainer rates.
- **Frustrations:** Re-learning each client's brand voice and tools; no clean way to keep client data/billing separated; manual reporting for every client, every month.
- **How BizPilot AI helps:** One workspace per client, each with its own Business Profile grounding AI output in that client's voice; team members move between workspaces instead of between disconnected tool logins.

## 5. User Journeys

### Journey A — First-time onboarding to first value (Persona: Solo Sam)
1. Sign up → verify email.
2. Guided setup: describe the business in a sentence, or paste a website URL for AI to draft a **Business Profile**.
3. Pick a primary goal ("Get more customers," "Respond to customers faster," "Create content consistently").
4. BizPilot AI generates one goal-matched artifact immediately (e.g., a week of social posts, or a draft email sequence) as an in-session "quick win."
5. Sam reviews/edits and publishes or schedules the first item — value delivered inside the first session, before any deep configuration.
6. Prompted (not forced) to invite a collaborator or connect an integration.

### Journey B — Launching an AI marketing campaign (Persona: Marketer Maya)
1. Create a **Project** ("Q2 Product Launch") inside the Marketing module.
2. Use the **AI Campaign Generator** with the Business Profile as context to produce a channel plan (email, social, landing copy).
3. Refine individual assets using **Content Creation** tools; save reusable phrasing to the **Prompt Library**.
4. Schedule assets on the **Marketing Calendar**; route select assets through an approval step to the founder.
5. Publish; track results in **Analytics**; AI surfaces which channel/asset outperformed for the next campaign.

### Journey C — Managing a sales deal end-to-end (Persona: Owner Olivia)
1. A lead comes in and lands in **Lead & Contact Management**.
2. **AI Sales Assistant** drafts a personalized first response and suggests next-best-action.
3. Deal moves across the **Pipeline** board; AI drafts a **Proposal/Quote** at the negotiation stage.
4. After a sales call, AI generates a **Call Summary** with follow-up tasks.
5. Deal closes; it's reflected automatically in **Sales Pipeline Analytics**.

### Journey D — Resolving a support ticket with AI assist (Persona: Owner Olivia's team)
1. Customer message arrives in the **Unified Support Inbox**.
2. **AI Support Agent** proposes a reply, citing the relevant **Knowledge Base** article.
3. Team member approves and sends (or edits first) — full auto-send is opt-in per plan/settings.
4. Ticket auto-closes on customer confirmation or timeout per **SLA** rules; a **CSAT** survey goes out.
5. Recurring question volume shows up in Analytics, prompting a new Knowledge Base article.

### Journey E — Agency managing multiple clients (Persona: Agency Alex)
1. Alex creates one **Workspace** per client, each with its own **Business Profile**, plan, and billing.
2. Team members are invited into specific client workspaces with scoped **roles**.
3. Alex uses the **Workspace Switcher** to move between clients without re-authenticating or re-explaining brand voice — the Business Profile grounds every AI output automatically.
4. Each client gets a monthly performance export from that workspace's Analytics — no manual cross-tool reporting.

## 6. Problems We Solve

| Problem | How BizPilot AI Solves It |
|---|---|
| Small teams can't afford dedicated marketing/sales/support headcount | AI performs the first draft of the work across all three functions inside one product |
| Business tool sprawl (separate CRM, helpdesk, social scheduler, doc tool, BI dashboard) | One workspace, one data model, one subscription |
| Inconsistent brand voice across content and channels | Business Profile + Brand Voice Trainer ground every AI generation in the same voice |
| Slow customer response times hurt conversion and retention | AI drafts replies/proposals/follow-ups in seconds, humans approve |
| No visibility into what's actually driving growth | Unified Analytics ties marketing, sales, and support activity together instead of living in separate tools |
| Repeated, low-leverage writing work (yet another social post, yet another follow-up email) | Templates, Prompt Library, and content repurposing eliminate blank-page time |
| Agencies re-learn each client's context and juggle per-client tool logins | Multi-workspace architecture with per-workspace Business Profiles and billing |

## 7. Core Value Proposition

**BizPilot AI turns one small team into a fully-staffed business operation — an AI co-pilot for marketing, sales, support, content, and analytics in a single workspace.**

Pillars:
- **Unified, not fragmented** — one workspace replaces a stack of point tools.
- **AI-native, not AI-bolted-on** — AI is the default first draft in every module, not a side chat window.
- **Brand-consistent by default** — every generation is grounded in a structured Business Profile.
- **Fast time-to-value** — a usable output in the first session, not after a lengthy setup.
- **Priced for small teams** — a free tier and low-friction paid tiers, not enterprise-only pricing.

---

## 8. Complete Feature Inventory

Priority key: **P0** = MVP/launch-blocking · **P1** = high priority, fast follow · **P2** = important, post-launch · **P3** = later/exploratory.

### 8.1 Marketing

#### AI Campaign Generator
- **Goal:** Turn a business goal into a ready-to-execute, multi-channel campaign plan.
- **Description:** Given a Business Profile and a stated objective (e.g., "promote our spring sale"), generates a channel plan (email, social, ads) with drafted copy per channel and a suggested schedule.
- **User Story:** As a marketer with no team, I want a full campaign drafted from one prompt, so I can ship in an afternoon instead of a week.
- **Priority:** P0
- **Dependencies:** Business Profiles, AI Credit System, Content Creation tools, Marketing Calendar.
- **Future Improvements:** Auto-generate variant tests (A/B copy); auto-select channels based on historical performance.

#### Social Media Composer & Scheduler
- **Goal:** Draft, review, and schedule social posts across platforms from one place.
- **Description:** AI-drafted or manually written posts with platform-specific formatting, scheduled publishing, and a visual content queue.
- **User Story:** As a small business owner, I want a week of social posts scheduled in one sitting, so social doesn't get dropped when I'm busy.
- **Priority:** P0
- **Dependencies:** Content Creation (AI Writer, Image Generator), Marketing Calendar, Integrations (social platform connections).
- **Future Improvements:** Best-time-to-post recommendations; auto-repost top performers.

#### AI Email Marketing Sequences
- **Goal:** Produce and send multi-step nurture/promotional email sequences.
- **Description:** AI drafts a sequence (welcome series, promo, re-engagement) from a goal and audience description; supports scheduling and basic segmentation.
- **User Story:** As a solopreneur, I want a welcome email series written for me, so new subscribers hear from me even when I don't have time to write.
- **Priority:** P1
- **Dependencies:** Business Profiles, Lead & Contact Management (recipient lists), Analytics.
- **Future Improvements:** Send-time optimization; behavioral trigger sequences (cart abandonment-style triggers for services).

#### Ad & Landing Page Copy Generator
- **Goal:** Produce conversion-oriented ad and landing page copy.
- **Description:** Generates headline/body variants for paid ads and landing pages, matched to the Business Profile's voice and a stated offer.
- **User Story:** As a founder running my own ads, I want strong ad copy without hiring a copywriter, so I can test campaigns cheaply.
- **Priority:** P1
- **Dependencies:** Business Profiles, Prompt Library, Templates.
- **Future Improvements:** Direct publish to ad platforms and landing page builders via integrations.

#### SEO Content Optimizer
- **Goal:** Improve the discoverability of written content.
- **Description:** Analyzes drafted content against a target keyword/topic and suggests structural, keyword, and readability improvements.
- **User Story:** As a marketer, I want my blog draft checked for SEO before publishing, so I don't need a separate SEO tool.
- **Priority:** P2
- **Dependencies:** Content Creation (AI Writer).
- **Future Improvements:** Keyword-gap analysis against competitors; automatic internal-linking suggestions.

#### Marketing Calendar
- **Goal:** Give a single, shared view of all planned marketing activity.
- **Description:** Calendar view spanning social, email, and campaign milestones, with drag-to-reschedule and approval-status indicators.
- **User Story:** As a founder, I want to see everything marketing has planned this month at a glance, so I can approve or redirect early.
- **Priority:** P1
- **Dependencies:** Social Composer, Email Sequences, Projects.
- **Future Improvements:** Cross-workspace calendar rollup for agencies.

### 8.2 Sales

#### Lead & Contact Management
- **Goal:** Capture and organize every prospect and customer in one record system.
- **Description:** Lightweight CRM: contact records, lead source tracking, notes, and activity timeline.
- **User Story:** As a business owner, I want every lead in one place instead of scattered across email and my memory, so nothing falls through the cracks.
- **Priority:** P0
- **Dependencies:** Workspace architecture, Business Profiles.
- **Future Improvements:** Lead scoring; auto-enrichment from public data sources.

#### AI Sales Assistant
- **Goal:** Give every deal a "next best action" and a drafted response.
- **Description:** Analyzes a lead/deal's context and suggests the next action (follow up, send proposal, schedule call) with a ready-to-send draft.
- **User Story:** As a non-salesperson running my own pipeline, I want AI to tell me what to do next with each lead, so deals don't go cold from my inattention.
- **Priority:** P0
- **Dependencies:** Lead & Contact Management, Pipeline, AI Credit System.
- **Future Improvements:** Deal-risk scoring; automatic reminders when a deal goes stale.

#### Deal Pipeline (Kanban)
- **Goal:** Visualize and move deals through defined sales stages.
- **Description:** Drag-and-drop board of deal stages, configurable per workspace, with deal value roll-ups per stage.
- **User Story:** As an owner, I want to see my whole pipeline on one board, so I know what's about to close and what's stuck.
- **Priority:** P0
- **Dependencies:** Lead & Contact Management.
- **Future Improvements:** Custom pipeline templates per industry; automated stage-change triggers.

#### AI Proposal & Quote Generator
- **Goal:** Produce professional, on-brand proposals/quotes quickly.
- **Description:** Generates a structured proposal or quote document from deal details and the Business Profile, with editable line items and pricing.
- **User Story:** As a service business owner, I want a polished proposal ready in minutes, so I can respond to hot leads before they cool off.
- **Priority:** P1
- **Dependencies:** Templates, Business Profiles, Deal Pipeline.
- **Future Improvements:** E-signature integration; auto-follow-up when a proposal is viewed but not signed.

#### Sales Follow-up Automation
- **Goal:** Prevent leads from going cold due to human follow-up delay.
- **Description:** Rule-based and AI-suggested follow-up sequences triggered by deal inactivity or stage changes.
- **User Story:** As a solo founder, I want automatic nudges sent to leads I haven't followed up with, so I don't lose deals to forgetfulness.
- **Priority:** P1
- **Dependencies:** AI Sales Assistant, Notifications.
- **Future Improvements:** Multi-touch cadences with channel mixing (email + SMS, future).

#### AI Meeting & Call Summaries
- **Goal:** Turn sales conversations into structured, actionable notes.
- **Description:** Ingests a call transcript/recording (via integration) and produces a summary, key points, and follow-up tasks attached to the deal.
- **User Story:** As a business owner, I want my sales calls summarized automatically, so I don't lose details I didn't have time to write down.
- **Priority:** P2
- **Dependencies:** Integrations (calling/video tools), Deal Pipeline, History.
- **Future Improvements:** Sentiment and objection-pattern analysis across all calls.

### 8.3 Customer Support

#### Unified Support Inbox
- **Goal:** Consolidate customer conversations from multiple channels into one queue.
- **Description:** Shared inbox aggregating email and (via integration) chat/social messages, with assignment and status tracking.
- **User Story:** As a support lead, I want every customer message in one inbox, so nothing gets missed across channels.
- **Priority:** P0
- **Dependencies:** Workspace architecture, Integrations, Team permissions.
- **Future Improvements:** Native live-chat widget; channel-specific SLA rules.

#### AI Support Agent
- **Goal:** Reduce response time and repetitive drafting for common questions.
- **Description:** Drafts (or, where enabled, auto-sends) replies grounded in the Knowledge Base and Business Profile; escalates when confidence is low.
- **User Story:** As a support rep, I want AI to draft my replies, so I spend my time reviewing instead of typing from scratch.
- **Priority:** P0
- **Dependencies:** Knowledge Base, Business Profiles, AI Credit System, AI Guardrails.
- **Future Improvements:** Full autonomous resolution for a defined, confidence-scored subset of tickets.

#### Knowledge Base Builder
- **Goal:** Give both customers and the AI Support Agent a source of truth.
- **Description:** Structured article editor with categories, search, and public/internal visibility per article.
- **User Story:** As a support lead, I want a help center that also powers AI answers, so I write documentation once and it pays off twice.
- **Priority:** P1
- **Dependencies:** Content Creation, AI Support Agent.
- **Future Improvements:** AI-suggested articles based on recurring unanswered questions.

#### Ticket Routing & SLA Management
- **Goal:** Ensure tickets reach the right person within a defined time.
- **Description:** Rule-based routing by category/keyword, configurable SLA timers, and breach alerts.
- **User Story:** As a support manager, I want urgent tickets automatically flagged and routed, so response times stay predictable as we grow.
- **Priority:** P2
- **Dependencies:** Unified Support Inbox, Team roles, Notifications.
- **Future Improvements:** AI-based ticket categorization and priority scoring.

#### CSAT Surveys
- **Goal:** Measure customer satisfaction at the point of resolution.
- **Description:** Automated post-resolution survey with a rolling satisfaction score visible in Analytics.
- **User Story:** As an owner, I want to know if customers are happy with support without asking them myself, so I can catch problems early.
- **Priority:** P2
- **Dependencies:** Unified Support Inbox, Analytics.
- **Future Improvements:** AI-summarized qualitative feedback themes.

### 8.4 Content Creation

#### AI Long-form Writer
- **Goal:** Produce first drafts of long-form content (blog posts, articles, guides).
- **Description:** Structured brief-to-draft generator using the Business Profile's voice, with section-level regeneration and editing.
- **User Story:** As a marketer, I want a full blog draft from an outline, so I edit instead of starting from a blank page.
- **Priority:** P0
- **Dependencies:** Business Profiles, AI Credit System, Prompt Library.
- **Future Improvements:** Multi-source research grounding (cite provided documents/links).

#### Brand Voice Trainer
- **Goal:** Make every AI generation sound like the business, not like generic AI.
- **Description:** Learns tone/style from sample text (existing website copy, past posts) and stores it as part of the Business Profile.
- **User Story:** As a business owner, I want AI to sound like me, so my content doesn't feel outsourced.
- **Priority:** P1
- **Dependencies:** Business Profiles.
- **Future Improvements:** Per-channel voice variants (formal for email, casual for social).

#### AI Image Generator
- **Goal:** Produce on-brand visuals without a designer.
- **Description:** Text-to-image generation constrained to brand colors/style where defined, for social posts, blog headers, and ads.
- **User Story:** As a solo founder, I want a matching image for my post generated instantly, so I don't need stock photos or a designer.
- **Priority:** P1
- **Dependencies:** Business Profiles, AI Credit System.
- **Future Improvements:** Brand kit-aware templates (auto-place logo, consistent layout).

#### Content Repurposing Engine
- **Goal:** Multiply the value of every piece of content created.
- **Description:** Converts one source asset (e.g., a blog post) into multiple derivative formats (social posts, email blurb, short video script).
- **User Story:** As a one-person marketing team, I want one blog post turned into a week of social content automatically, so I get more output from the same effort.
- **Priority:** P1
- **Dependencies:** AI Long-form Writer, Social Composer, Email Sequences.
- **Future Improvements:** Auto-publish derivative content directly to the Marketing Calendar.

#### Content Calendar & Approval Workflow
- **Goal:** Keep content production organized and reviewed before publishing.
- **Description:** Status-based content pipeline (Draft → In Review → Approved → Published) with commenting and assignment.
- **User Story:** As a founder, I want to approve content before it goes out, so my team can create freely without me worrying about mistakes.
- **Priority:** P2
- **Dependencies:** Projects, Team roles, Notifications.
- **Future Improvements:** Configurable multi-stage approval chains for larger teams.

### 8.5 Analytics

#### Unified Business Dashboard
- **Goal:** Give one glance-able view of overall business health.
- **Description:** Home dashboard combining top-line marketing, sales, and support metrics for the active workspace.
- **User Story:** As an owner, I want one dashboard that tells me how the business is doing, so I don't have to piece it together from five tools.
- **Priority:** P0
- **Dependencies:** Marketing, Sales, and Support modules (data sources).
- **Future Improvements:** Customizable widget layout.

#### AI Insights & Recommendations ("AI Analyst")
- **Goal:** Turn raw metrics into plain-language guidance.
- **Description:** Periodically analyzes workspace data and surfaces narrative insights and suggested actions (e.g., "email open rates dropped 20% — try a new subject line pattern").
- **User Story:** As a non-analytical business owner, I want AI to tell me what my numbers mean, so I can act without being a data analyst.
- **Priority:** P1
- **Dependencies:** Unified Business Dashboard, AI Credit System.
- **Future Improvements:** Proactive alerting (push an insight the moment an anomaly is detected, not just on a schedule).

#### Campaign Performance Analytics
- **Goal:** Show which marketing efforts actually work.
- **Description:** Per-campaign and per-channel performance (opens, clicks, engagement, conversions where trackable).
- **User Story:** As a marketer, I want to see which campaign drove results, so I know what to repeat.
- **Priority:** P1
- **Dependencies:** Marketing module features, Integrations.
- **Future Improvements:** Multi-touch attribution across campaigns.

#### Sales Pipeline Analytics
- **Goal:** Show pipeline health and forecast revenue.
- **Description:** Conversion rates by stage, average deal cycle time, and simple forecasting based on pipeline value and stage probability.
- **User Story:** As an owner, I want to know if my pipeline is healthy enough to hit my revenue goal, so I can course-correct early.
- **Priority:** P1
- **Dependencies:** Deal Pipeline.
- **Future Improvements:** AI-generated forecast confidence ranges.

#### Custom Report Builder
- **Goal:** Let advanced users build the specific report they need.
- **Description:** Drag-and-drop metric/dimension selection across modules, with saved and shareable reports.
- **User Story:** As an agency owner, I want a custom monthly report per client, so I can hand clients exactly what they expect.
- **Priority:** P2
- **Dependencies:** Unified Business Dashboard, Workspace architecture.
- **Future Improvements:** Scheduled automatic report delivery (email/PDF).

### 8.6 AI (Platform Layer)

#### BizPilot Copilot
- **Goal:** Provide one conversational entry point to every module.
- **Description:** Persistent, workspace-aware chat assistant that can answer questions, trigger actions ("draft a follow-up to Acme Corp"), and navigate the user to the right place.
- **User Story:** As any user, I want to just ask for what I need in plain language, so I don't have to learn where every feature lives.
- **Priority:** P0
- **Dependencies:** All modules (as callable capabilities), AI Credit System, Business Profiles.
- **Future Improvements:** Voice input; proactive suggestions surfaced without being asked.

#### Prompt Library
- **Goal:** Make good AI results repeatable, not one-off.
- **Description:** Saved, reusable, categorized prompts — personal or workspace-shared — usable across AI features. *(Full design in §17.)*
- **User Story:** As a marketer, I want to save a prompt that works well, so my whole team gets the same quality every time.
- **Priority:** P1
- **Dependencies:** BizPilot Copilot, AI Credit System.
- **Future Improvements:** Community/marketplace prompt sharing (see §19).

#### AI Credit Meter & Usage Insights
- **Goal:** Keep AI usage transparent and predictable.
- **Description:** Real-time credit balance, per-feature usage breakdown, and forecasted burn rate. *(Full design in §16.)*
- **User Story:** As a plan admin, I want to see what's consuming our AI credits, so I'm never surprised by an overage.
- **Priority:** P0
- **Dependencies:** Billing.
- **Future Improvements:** Per-member usage budgets/caps.

#### AI Workflow Automations
- **Goal:** Let AI act on triggers, not just on request.
- **Description:** "When X happens, do Y with AI" rules (e.g., "when a lead is 3 days inactive, draft a follow-up").
- **User Story:** As a busy owner, I want routine AI actions to happen without me asking each time, so the business keeps moving while I'm not looking.
- **Priority:** P2
- **Dependencies:** AI Sales Assistant, Sales Follow-up Automation, Notifications.
- **Future Improvements:** Visual automation builder; cross-module trigger chaining.

#### AI Guardrails & Brand-Safety Review
- **Goal:** Prevent off-brand, incorrect, or non-compliant AI output from reaching customers.
- **Description:** Configurable review layer checking generated content against brand rules, banned terms, and (support) factual grounding in the Knowledge Base before send/publish.
- **User Story:** As a business owner, I want a safety check before AI content goes out, so an AI mistake doesn't damage my reputation.
- **Priority:** P1
- **Dependencies:** Business Profiles, Knowledge Base, AI Support Agent.
- **Future Improvements:** Configurable compliance rule sets for regulated industries.

#### Multi-Model Provider Routing
- **Goal:** Keep BizPilot AI resilient and cost-efficient as models evolve.
- **Description:** Internal abstraction routing each AI task to the best available model/provider (OpenAI-ready at launch) without user-visible disruption.
- **User Story:** As the business (internal), we want to swap or mix model providers without rewriting features, so we stay competitive on quality and cost.
- **Priority:** P0 *(infrastructure — user-invisible)*
- **Dependencies:** None (foundational).
- **Future Improvements:** Per-task model selection based on cost/quality tradeoff; customer-bespoke fine-tuned models at Enterprise tier.

### 8.7 Settings

#### Account Settings
- **Goal:** Let a user manage their own identity and security.
- **Description:** Profile info, password/2FA, connected login methods, session management.
- **User Story:** As a user, I want to secure my own account, so my business data stays protected.
- **Priority:** P0
- **Dependencies:** Authentication.
- **Future Improvements:** Passkey support.

#### Workspace Settings & Branding
- **Goal:** Configure workspace-level defaults and identity.
- **Description:** Workspace name, default Business Profile, timezone/locale, and branding used across generated documents (proposals, reports).
- **User Story:** As a workspace owner, I want my workspace configured once, so it's consistent everywhere it's used.
- **Priority:** P0
- **Dependencies:** Workspace architecture.
- **Future Improvements:** White-labeling for agency-tier client-facing documents.

#### Integrations Hub
- **Goal:** Connect BizPilot AI to the tools a business already uses.
- **Description:** Managed connections (OAuth-based) to email, calendar, social platforms, calling tools, and payment providers.
- **User Story:** As an owner, I want my existing email and calendar connected, so BizPilot AI works with my real data instead of in isolation.
- **Priority:** P1
- **Dependencies:** None (parallel infrastructure track).
- **Future Improvements:** Public integration marketplace (see §19).

#### Notification Preferences
- **Goal:** Let users control what reaches them and how. *(Full design in §15.)*
- **Description:** Granular per-category, per-channel notification toggles.
- **User Story:** As a user, I want to mute noise but never miss what matters, so notifications stay useful.
- **Priority:** P1
- **Dependencies:** Notifications system.
- **Future Improvements:** Digest scheduling (daily/weekly rollups).

#### API Keys & Webhooks
- **Goal:** Enable programmatic and custom integrations for advanced customers.
- **Description:** Scoped API key issuance and outbound webhook configuration for workspace events.
- **User Story:** As a technical customer, I want to pull my data into my own systems, so BizPilot AI fits into my existing stack.
- **Priority:** P3
- **Dependencies:** Public API (future), Permission system.
- **Future Improvements:** Full public API + developer portal.

### 8.8 Workspace

#### Multi-Workspace Management
- **Goal:** Let one user operate across multiple, fully separated businesses. *(Full design in §12.)*
- **Description:** Users can belong to and switch between multiple workspaces, each an isolated tenant.
- **User Story:** As an agency owner, I want each client fully isolated, so data and billing never mix.
- **Priority:** P0
- **Dependencies:** Authentication, Permission system.
- **Future Improvements:** Cross-workspace reporting rollup for agency admins.

#### Business Profiles
- **Goal:** Ground every AI output in accurate, consistent business context. *(Full design in §18.)*
- **Description:** Structured record of brand voice, audience, offering, and identity, attachable to any AI generation.
- **User Story:** As any user, I want AI to already know my business, so I'm not re-explaining context every time.
- **Priority:** P0
- **Dependencies:** Workspace architecture.
- **Future Improvements:** Multiple profiles per workspace for multi-brand businesses.

#### Projects
- **Goal:** Organize related work into a shared container. *(Full design in §17.)*
- **Description:** A project groups content, tasks, AI threads, and files around a shared goal (a campaign, a client engagement).
- **User Story:** As a marketer, I want everything for one campaign in one place, so I'm not hunting across modules.
- **Priority:** P1
- **Dependencies:** Workspace architecture.
- **Future Improvements:** Project templates (see §18).

#### Workspace Audit Log
- **Goal:** Provide accountability and traceability for workspace activity.
- **Description:** Chronological, filterable log of significant actions (permission changes, deletions, billing changes, AI sends).
- **User Story:** As a workspace owner, I want to see who did what, so I can trust a growing team with access.
- **Priority:** P2
- **Dependencies:** Permission system.
- **Future Improvements:** Exportable compliance-grade logs (Enterprise).

#### File & Asset Manager
- **Goal:** Centralize the files a business's content and AI work depend on.
- **Description:** Workspace-level file storage (logos, brand assets, documents) referenceable from any module.
- **User Story:** As a team member, I want our brand assets in one library, so everyone uses the current logo and colors.
- **Priority:** P2
- **Dependencies:** Business Profiles.
- **Future Improvements:** Version history per asset.

### 8.9 Team

#### Team Invitations
- **Goal:** Bring collaborators into a workspace with minimal friction.
- **Description:** Email-based invitation flow with a pre-assigned role.
- **User Story:** As a workspace owner, I want to invite my teammate in under a minute, so onboarding them isn't a chore.
- **Priority:** P0
- **Dependencies:** Permission system.
- **Future Improvements:** Bulk invite via CSV; domain-based auto-join (Enterprise).

#### Roles & Permissions
- **Goal:** Control who can see and do what. *(Full design in §11.)*
- **Description:** Role-based access control scoped per workspace.
- **User Story:** As an owner, I want to limit what a new contractor can access, so I stay in control as the team grows.
- **Priority:** P0
- **Dependencies:** Workspace architecture.
- **Future Improvements:** Custom roles with granular permission sets (Enterprise).

#### Task Assignment
- **Goal:** Turn AI/human work into trackable, owned to-dos.
- **Description:** Lightweight tasks assignable to team members, attachable to Projects, deals, or tickets.
- **User Story:** As a manager, I want to assign the follow-ups AI suggests, so they don't just sit as suggestions.
- **Priority:** P1
- **Dependencies:** Projects, Notifications.
- **Future Improvements:** Task dependencies and due-date automation.

#### Team Activity Feed
- **Goal:** Give the team situational awareness without meetings.
- **Description:** Real-time feed of teammate actions (content published, deal moved, ticket resolved) scoped to the workspace.
- **User Story:** As a team member, I want to see what my teammates just did, so we stay in sync asynchronously.
- **Priority:** P2
- **Dependencies:** Workspace Audit Log (shared underlying event stream).
- **Future Improvements:** @mentions and threaded comments on activity items.

#### Team Performance Dashboard
- **Goal:** Show how the team is contributing, not just the business overall.
- **Description:** Per-member activity and output metrics (content shipped, deals closed, tickets resolved).
- **User Story:** As a manager, I want to see team contribution at a glance, so I can coach and recognize effectively.
- **Priority:** P3
- **Dependencies:** Analytics, Team Activity Feed.
- **Future Improvements:** Goal-setting per team member with progress tracking.

### 8.10 Billing

#### Subscription Plan Management
- **Goal:** Let workspace owners choose and change their plan.
- **Description:** Self-serve plan selection, upgrade, and downgrade. *(Plans defined in §9.)*
- **User Story:** As an owner, I want to upgrade the moment I need more, so growth isn't blocked by a sales call.
- **Priority:** P0
- **Dependencies:** Billing provider integration.
- **Future Improvements:** Annual-commitment discounts with self-serve proration.

#### AI Credit Top-ups
- **Goal:** Let workspaces get more AI capacity without changing plan tier.
- **Description:** One-time or recurring credit pack purchases layered on top of the plan's included allowance.
- **User Story:** As a power user on a mid-tier plan, I want to buy more credits for one busy month, so I'm not forced into a permanent upgrade.
- **Priority:** P1
- **Dependencies:** AI Credit System.
- **Future Improvements:** Auto-top-up rules with spend caps.

#### Invoices & Payment History
- **Goal:** Give finance-relevant users a clear billing record.
- **Description:** Downloadable invoice history and payment status.
- **User Story:** As a business owner, I want my invoices available for my bookkeeping, so tax time isn't a scramble.
- **Priority:** P1
- **Dependencies:** Billing provider integration.
- **Future Improvements:** Direct accounting-software sync (QuickBooks/Xero).

#### Usage Alerts & Overage Protection
- **Goal:** Prevent bill shock from AI usage.
- **Description:** Configurable thresholds trigger warnings before hitting the credit limit, with a choice to hard-stop or soft-allow overage billing.
- **User Story:** As a budget-conscious owner, I want to be warned before I'm charged extra, so I'm always in control of spend.
- **Priority:** P0
- **Dependencies:** AI Credit System, Notifications.
- **Future Improvements:** Predictive "you'll run out in N days" alerts.

#### Plan Upgrade/Downgrade Flow
- **Goal:** Make plan changes frictionless and transparent.
- **Description:** In-app comparison of plans with clear proration and feature-loss warnings on downgrade.
- **User Story:** As an owner considering an upgrade, I want to see exactly what changes, so I can decide confidently without contacting support.
- **Priority:** P1
- **Dependencies:** Subscription Plan Management.
- **Future Improvements:** AI-suggested "you'd benefit from Pro" prompts based on usage patterns.

---

## 9. Subscription Plans

| | **Free** | **Starter** | **Pro** | **Business** | **Enterprise** |
|---|---|---|---|---|---|
| **Target user** | Trying BizPilot AI, hobby use | Solo Sam | Owner Olivia, Marketer Maya | Growing teams, small agencies | Agency Alex at scale, larger orgs |
| **Price** | $0 | $19/mo | $49/mo | $149/mo | Custom |
| **Workspaces** | 1 | 1 | 1 | 3 | Unlimited |
| **Team seats included** | 1 | 2 | 5 | 15 | Unlimited (negotiated) |
| **AI credits / month** | 100 | 1,000 | 5,000 | 20,000 | Custom pool |
| **Business Profiles per workspace** | 1 | 1 | 3 | 10 | Unlimited |
| **Projects** | 2 active | 10 active | Unlimited | Unlimited | Unlimited |
| **Marketing module** | Basic (1 channel) | Full | Full | Full | Full + custom workflows |
| **Sales module** | View-only pipeline | Full (1 pipeline) | Full (multiple pipelines) | Full + automation | Full + custom automation |
| **Support module** | — | Inbox only | Inbox + AI Agent | Inbox + AI Agent + SLAs | + custom SLAs & routing |
| **Content Creation** | Limited templates | Full | Full + Brand Voice Trainer | Full + multi-brand voices | Full + fine-tuned brand model |
| **Analytics** | Summary dashboard | Standard dashboard | + AI Insights | + Custom Report Builder | + cross-workspace rollup |
| **Prompt Library** | Personal, 5 saved | Personal, unlimited | Workspace-shared | Workspace-shared + folders | Org-wide governance |
| **Templates** | System templates only | System templates | System + custom | System + custom + shared library | + white-labeled templates |
| **Permissions** | N/A (single user) | Owner/Member | + Manager role | + custom role assignment | Custom roles & policies |
| **Integrations** | 1 | 3 | Unlimited standard | Unlimited standard | + custom/API integrations |
| **API access** | — | — | — | Read-only | Full |
| **Support** | Community/self-serve | Email | Priority email | Priority + chat | Dedicated CSM + SLA |
| **Data retention (History)** | 30 days | 90 days | 1 year | 2 years | Custom/compliance-driven |

**Overage behavior:** Free and Starter hard-stop at the credit limit (upgrade or top-up prompt). Pro, Business, and Enterprise soft-allow metered overage by default, configurable to hard-stop in Billing settings (see §16).

---

## 10. Permission System

### Roles (workspace-scoped)

| Role | Summary |
|---|---|
| **Owner** | Full control: billing, workspace deletion, all permission grants. One per workspace, transferable. |
| **Admin** | Full operational control (team, settings, all modules) except billing and workspace deletion. |
| **Manager** | Full access within assigned modules (e.g., a Sales Manager has full Sales access, read-only elsewhere). |
| **Member** | Standard contributor access to assigned modules; cannot manage team, billing, or workspace settings. |
| **Viewer** | Read-only access across permitted modules — for stakeholders who need visibility, not editing. |
| **Guest (client)** | Scoped, time-limited access to specific shared items (e.g., a proposal or a report) without workspace membership. |

### Design principles
- **Workspace-scoped, not global.** A user's role is set per workspace — Agency Alex can be Owner in one client workspace and Manager in another.
- **Module-level scoping for Manager/Member.** Roles above Viewer can be scoped to specific modules (e.g., "Manager — Sales only") rather than being all-or-nothing, so a support lead doesn't automatically get sales access.
- **Least privilege by default.** New invitations default to Member with no module scope until explicitly granted.
- **Custom roles are an Enterprise capability** — granular, named permission sets beyond the standard six, built from atomic permissions (`view`, `create`, `edit`, `delete`, `approve`, `send/publish`, `manage-billing`, `manage-team`).
- **Sensitive actions always require Owner/Admin:** billing changes, workspace deletion, permission escalation, and API key issuance are never delegable to Manager/Member regardless of module scope.

### Representative permission matrix

| Action | Owner | Admin | Manager (scoped) | Member (scoped) | Viewer |
|---|---|---|---|---|---|
| Edit billing / plan | ✅ | ❌ | ❌ | ❌ | ❌ |
| Invite/remove team members | ✅ | ✅ | ❌ | ❌ | ❌ |
| Manage workspace settings | ✅ | ✅ | ❌ | ❌ | ❌ |
| Create/edit content in scoped module | ✅ | ✅ | ✅ | ✅ | ❌ |
| Approve/publish in scoped module | ✅ | ✅ | ✅ | ❌ | ❌ |
| View analytics in scoped module | ✅ | ✅ | ✅ | ✅ | ✅ |
| Delete workspace | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## 11. Workspace Architecture

```
User Account
  └── belongs to N Workspaces (each with its own role)

Workspace  (the tenant boundary — billing, data isolation, AI credit pool)
  ├── Settings (branding, defaults, integrations)
  ├── Team (members + roles)
  ├── Business Profile(s)  →  1 default, more on Pro+
  │     └── grounds AI output for everything below
  ├── Projects
  │     ├── Content items (Marketing/Content Creation)
  │     ├── Tasks
  │     ├── Files
  │     └── AI generation threads
  ├── Sales (Contacts, Pipeline, Deals)
  ├── Support (Inbox, Knowledge Base, Tickets)
  ├── Analytics (derived from all of the above)
  ├── Prompt Library (personal + workspace-shared)
  ├── Templates (system + custom)
  └── Audit Log
```

**Key rules:**
- **Workspace = strict data isolation boundary.** No data (contacts, content, AI history, files) ever crosses workspaces implicitly. Cross-workspace visibility (e.g., an agency rollup report) is always an explicit, permissioned aggregation — never shared storage.
- **AI credits pool at the workspace level**, not per-user, so a small team shares one predictable budget (see §16).
- **A user's identity is global; their access is local.** One login, many workspaces, independent roles and independent Business Profiles per workspace — this is what makes the agency use case (Persona: Agency Alex) work without a separate "agency mode."
- **Business Profile is the grounding context object** referenced by nearly every AI feature — it is architecturally a workspace-level (not project-level) entity so it stays consistent across everything generated in that workspace.

---

## 12. Onboarding Design

**Principle:** get to one real, usable output before asking for any deep configuration.

1. **Sign up** (email or SSO) → verify.
2. **Business capture:** either paste a website URL (AI extracts a draft Business Profile: name, industry, tone, offering) or answer three short prompts manually. Always editable, never blocking.
3. **Goal selection:** single-choice ("Get more customers," "Respond faster," "Create content consistently," "Just exploring") — this determines which module the guided flow highlights next, not what's available (everything remains accessible).
4. **First AI output, in-session:** based on the goal, BizPilot AI immediately generates one concrete artifact (a week of social posts, a lead follow-up draft, a help-center starter article). This is the "aha moment" and happens before any pricing or team-invite prompt.
5. **Review & keep/discard:** user edits or accepts the generated artifact — teaches the edit-and-approve interaction pattern used everywhere in the product.
6. **Soft prompts (skippable, not gated):** invite a teammate; connect one integration (email or calendar); explore the Prompt Library.
7. **Ongoing onboarding checklist** (dismissible widget on the dashboard) tracks remaining setup (connect an integration, create a second project, invite the team) without blocking any feature.

**Branching:** if the user arrives via a team invitation instead of signup, steps 2–4 are skipped (workspace context already exists) and onboarding starts at a lightweight "here's what your team is already doing" tour.

---

## 13. Navigation Design

**Primary sidebar** (maps directly to the feature categories in §8, matching the existing design-system `Sidebar`/`DashboardLayout` components):

```
🏠 Home (Unified Dashboard)
💬 AI Copilot
📣 Marketing
💼 Sales
🎧 Support
✍️  Content
📊 Analytics
📁 Projects
👥 Team
⚙️  Settings
```

- **Workspace switcher** lives at the top of the sidebar (above navigation), not in Settings — switching context should never be more than one click away, critical for the agency persona.
- **Billing** is not a sidebar item; it lives under the account/workspace menu in the top bar, since it's an occasional action, not daily navigation.

**Top bar:**
- Global search / command palette (`⌘K`) — jumps to any contact, deal, ticket, project, or content item across the active workspace.
- AI credit meter (compact, expands to the full usage breakdown on click).
- Notification bell.
- User menu (account settings, workspace list, sign out).

**Responsive behavior:** collapses to the icon-rail sidebar at tablet width and the slide-in drawer at mobile width (already implemented in the design system — see `frontend/src/shared/components/layout/`). The AI Copilot remains reachable as a persistent floating entry point at every breakpoint, since it's the fastest path to any action.

---

## 14. Notifications Design

### Categories

| Category | Examples | Default channel |
|---|---|---|
| **AI** | Generation complete, credit threshold reached, guardrail flagged content | In-app + email digest |
| **Sales** | New lead, deal stage change, follow-up due | In-app + email (real-time) |
| **Support** | New ticket, SLA breach warning, CSAT response | In-app + email (real-time) |
| **Team/Collaboration** | Mentioned in a comment, task assigned, content awaiting your approval | In-app real-time |
| **Billing** | Plan renewal, payment failure, usage overage | Email (always-on, cannot be muted) |
| **System** | Security alerts, workspace changes | Email (always-on, cannot be muted) |

### Design rules
- **Two channels at launch:** in-app (notification center) and email; architecture reserves a slot for push (future mobile app).
- **Per-category, per-channel control** in Notification Preferences — a user can mute Sales in-app pings but keep the email digest, for example.
- **Billing and Security are non-mutable** — never fully silence-able, only redirected to a different recipient (e.g., billing alerts can be routed to a finance contact instead of the Owner).
- **Real-time vs. digest:** time-sensitive categories (Support SLA breach, Sales follow-up due) default to real-time; lower-urgency categories (AI generation complete, Team activity) default to a daily digest to avoid alert fatigue.
- **In-app notification center** groups by category with unread state, matching the design system's `Toast` (transient, immediate) vs. persistent notification-center distinction: a Toast fires once for the live moment; the notification center is the durable, revisitable record.

---

## 15. AI Credit System

### Unit
One **AI credit** ≈ one standardized unit of model compute, normalized across task types so it can be surfaced as one simple number rather than raw tokens.

### Consumption by action type (indicative)

| Action | Approx. credit cost |
|---|---|
| Copilot chat message | 1 |
| Short content generation (social post, email subject) | 2–3 |
| Long-form generation (blog post, proposal) | 10–15 |
| Image generation | 8 |
| Call/meeting summary | 5 |
| Automation run (AI Workflow) | 3–8 (task-dependent) |
| AI Insights report | 10 |

### Rules
- **Pooled at the workspace level** (see §11) — the whole team shares one balance, visible to everyone, fully controlled by Owner/Admin.
- **Monthly allowance resets on the billing cycle date**; unused credits **do not roll over** on Free/Starter, **roll over up to one month's allowance** on Pro/Business, **configurable** on Enterprise.
- **Top-up packs** purchasable anytime without a plan change (§8.10).
- **Overage handling** is a workspace setting: *hard stop* (block further AI actions until top-up/next cycle) or *soft allow* (continue, billed as metered overage) — Free/Starter are hard-stop only; Pro and above can choose.
- **Full transparency:** the credit meter (top bar, §13) always shows current balance; clicking it opens a breakdown by module and by team member, plus a forecasted "credits remaining this cycle at current pace."
- **Guardrail-blocked or failed generations are not charged.**

---

## 16. History Design

BizPilot AI keeps five distinct kinds of history, each serving a different need:

| History type | What it captures | Where it surfaces |
|---|---|---|
| **AI Generation History** | Every prompt + output pair, per feature, per user | Copilot panel, per-content-item "history" tab |
| **Content Version History** | Saved revisions of any editable content item (posts, articles, proposals) | Content editor — restore any prior version |
| **Deal/Ticket Timeline** | Chronological activity on a specific deal or ticket (status changes, messages, AI actions) | Deal detail view, Ticket detail view |
| **Workspace Audit Log** | Permission changes, deletions, billing changes, member changes (§8.8) | Settings → Audit Log |
| **Team Activity Feed** | Human-facing, lightweight "what happened" stream (not a compliance record) | Home dashboard widget |

**Rules:**
- Generation and Version history support **restore/revert**, not just viewing — an edited AI draft can always be rolled back.
- Retention length is plan-dependent (§9); once retention expires, history is purged, not just hidden, in line with data-minimization practice.
- Audit Log is **immutable and export-only** (compliance record); Generation/Version history is **restorable** (working record) — this distinction is intentional and load-bearing for how each is built.

---

## 17. Projects Design

A **Project** is the organizing container for related work inside a workspace — the unit above individual content items and below the workspace itself.

- **Structure:** name, goal/description, optional linked Business Profile (for multi-brand workspaces), status (`Active`/`On Hold`/`Completed`/`Archived`), owner, and members.
- **Contents:** any mix of content items (Marketing/Content Creation), tasks, files, and AI generation threads — a project is a view/grouping over these, not a separate data silo.
- **Typical uses:** a marketing campaign, a client engagement (agency use case), a product launch, a content series.
- **Lifecycle:** Draft → Active → Completed/Archived. Archived projects remain read-accessible (subject to History retention, §16) but drop out of active navigation and active-project plan limits (§9).
- **Collaboration:** members are a subset of workspace team members with project-level visibility; comments and @mentions live at the project and content-item level.
- **Relationship to Templates (§18):** a Project can be created *from* a template (pre-populated with a task list and content skeleton), but a Project itself is never a template.

---

## 18. Templates Design

Templates exist across every content-producing module so users start from a proven structure rather than a blank page.

**Types:**
- **Content templates** — blog post structures, social post formats, ad copy formats.
- **Email templates** — sequences (welcome, promo, re-engagement), transactional-style formats.
- **Sales templates** — proposal/quote structures, outreach templates.
- **Support templates ("macros")** — canned response structures for the AI Support Agent to fill in, not just static text.
- **Project templates** — a pre-built Project skeleton (task list + content plan) for a repeatable workflow like "monthly newsletter" or "client onboarding."

**Design rules:**
- **System templates** are curated, versioned, and maintained centrally — available on every plan (Free gets a limited set, §9).
- **Custom templates** (Starter+) let a user save any content item as a reusable template, personal or workspace-shared.
- **Variable/personalization tokens** (e.g., `{{business_name}}`, `{{recipient_first_name}}`) pull automatically from the Business Profile or the record a template is applied to — this is what makes a template "smart" rather than a static doc.
- **Discovery:** templates are browsable by module and searchable from the point of creation (e.g., "New social post" offers a template picker inline, not a separate library page you have to remember to visit).
- **Forward path to §19 (Marketplace):** the template data model (author, category, variables, usage count) is designed from day one to support a future public/community template gallery without rework.

---

## 19. Prompt Library Design

Distinct from Templates: a **Template** produces a structured *content artifact*; a **Prompt** is a reusable *instruction* fed to the Copilot or any AI feature — often shorter, more instructional, and composable.

- **Scope:** Personal (private to the user) or Workspace (shared with the team, Pro+) — see plan limits in §9.
- **Structure:** title, the prompt text (may include the same `{{variable}}` tokens as Templates), category/tags, target feature (e.g., "Sales — Follow-up," "Content — Blog intro"), and an estimated AI-credit cost shown before use.
- **Lifecycle:** every prompt is versioned — editing creates a new version rather than overwriting, so a team can see what changed if a previously reliable prompt starts producing worse output.
- **Usage tracking:** each prompt shows how often it's been used and by whom, surfacing the team's actual best-performing prompts organically (a lightweight, built-in way to find "what's working" without a separate analytics view).
- **Favorites/pinning:** users pin their most-used prompts to the top of the Copilot's prompt picker.
- **Relationship to Projects:** a prompt can be run directly from within a Project, with its output automatically attached to that project's AI Generation History (§16).
- **Forward path to §19 marketplace:** like Templates, prompts are structured to support future community sharing and, eventually, monetized prompt packs from verified creators.

---

## 20. Business Profiles Design

The Business Profile is the single most important grounding object in the product — it's what makes every AI output sound like *this* business instead of a generic AI.

**Fields:**
- Business name, industry/category, one-line description.
- Target audience description.
- Brand voice/tone (structured attributes, e.g., formal↔casual, playful↔serious — plus free-text notes and, on Pro+, samples fed to the Brand Voice Trainer, §8.4).
- Visual identity: logo, primary/secondary colors (referenced by the AI Image Generator and document templates).
- Website and social links (source for AI auto-fill during onboarding and for factual grounding).
- Key offerings/products (short structured list, used by Sales and Marketing generation).

**Rules:**
- **Workspace-level entity** (§11): one default Business Profile per workspace on Free/Starter.
- **Multiple profiles per workspace** unlock on Pro+ (§9) for businesses with distinct sub-brands or, at the top end, agencies who — instead of one workspace per client — may choose one workspace with multiple client Business Profiles for lighter-weight client management (an alternative pattern to full workspace-per-client, offered for flexibility).
- **Every AI-generating feature accepts (and by default auto-applies) the workspace's default Business Profile** as grounding context — a user never has to manually re-explain their business per generation.
- **Editable at any time**, with changes applying prospectively (past generations are not retroactively altered, preserving History integrity, §16).

---

## 21. Future Marketplace Design

A long-term extension point, not part of MVP scope — the data model in §18/§19 is deliberately built to make this additive rather than a rework.

**Vision:** an open marketplace layered on top of the Template and Prompt Library systems, plus an Integrations gallery, where BizPilot AI's own team and eventually vetted third-party creators publish reusable assets.

**Planned components:**
- **Template Marketplace** — community and creator-published content/project templates, browsable by category and industry, ratings/reviews, install-to-workspace in one click.
- **Prompt Marketplace** — packaged, tested prompt bundles for specific use cases or industries (e.g., "Real Estate Listing Pack," "SaaS Support Macros").
- **Integration/Plugin Marketplace** — third-party-built connectors and mini-apps extending BizPilot AI beyond first-party Integrations (§8.7).
- **Creator program:** verified creators publish paid or free assets; BizPilot AI takes a revenue share on paid listings.
- **Quality & safety curation:** all listings pass through the same AI Guardrails review (§8.6) used for customer-facing content, plus manual review for paid/featured listings, before publication.

**Phased rollout (indicative, post-MVP):**
1. Internal/first-party template and prompt packs surfaced through the existing library UI (no external marketplace yet).
2. Read-only community gallery (free, BizPilot-curated submissions).
3. Full marketplace with creator payouts, ratings, and paid listings.
4. Third-party integration/plugin submissions opened via a developer program (ties to the API access line in §9, Business/Enterprise).

---

*End of PRD.*
