# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary: technical and ops teams (developers, operators) who design automations as workflows,
validate and publish them, then watch and recover their executions. Long sessions on desktop,
inside an organization (multi-tenant) with roles owner, editor and viewer. A secondary audience is
less technical people who describe a process in natural language, review the compiler's draft and
approve human steps; the interface must stay legible to them without hiding the graph model.

The product is used for real, day to day, by its author and the people they invite (confirmed
answer: "producto real para uso propio"). It is also a portfolio piece: it is evaluated by
recruiters and technical leads who open the production site and read the repository.

## Product Purpose

CognitiveDAG is a multi-tenant platform to design, validate, publish and run workflows as DAGs.
Nodes can call an LLM, make HTTP requests, wait for human approval, or branch and merge; runs start
from manual input, webhooks or cron. A compiler turns natural language into a draft DAG that a
person reviews and publishes. Execution is durable and fault-tolerant (Temporal), with live run
views, retries, cancel, rerun and partial recovery.

Success: a user goes from an idea to a published, running workflow and can always tell what is
running, what failed, why, and what they can do next.

## Positioning

The LLM is a bounded compiler, not an autonomous agent: it never decides at run time what to do
outside the published graph, and nothing runs without an explicit human publish. Few automation
tools make that control model visible; the interface should make it legible (draft vs published,
who approved, what each node may do).

## Operating Context

- Production: https://cognitive.devama.cloud; every merge to `main` deploys automatically.
- UI language is Spanish; code, commits and README are English.
- Core surfaces: workflow list and visual editor (@xyflow/react), natural language compiler,
  runs list and live run detail, human approvals, triggers (webhooks, cron), connections
  (credentials, HTTP hosts, LLM), members and invitations, account.
- Registration is closed; access is by invitation (the login page's "Crear cuenta" link leads to
  a 404 today and must not remain).
- Production serves a strict CSP (`default-src 'self'; script-src 'self'; style-src 'self';
font-src 'self'; img-src 'self' data:`), COEP `require-corp`, COOP/CORP same-origin. Fonts and
  assets must ship in the bundle; no inline styles or injected `<style>`. The header contract is
  checked on every deploy and changes only with an ADR.

## Capabilities and Constraints

- Stack: React 19, Vite, Tailwind 4, Radix, TanStack Router/Query, @xyflow/react.
- Run and step states to represent: running, succeeded, failed, cancelled, skipped, reused, waiting.
- Failure classes shown on failed steps: transient, rate limited, timeout, permanent.
- Node categories: trigger, logic, LLM, HTTP, human approval, mock service.
- Deploys can briefly return 503; the UI must degrade gracefully and let the user retry.
- This phase (F10) is a frontend redesign only; no API, worker or deploy changes. Functional
  integrations work follows afterward.

## Brand Commitments

Name: CognitiveDAG. No logo or brand assets exist yet; identity is to be created in the redesign.
Existing visual look (shadcn defaults, blue oklch(0.45 0.16 265)) is explicitly not a commitment.

## Evidence on Hand

Real production deployment, real run history by the author, 84+ merged PRs, ADRs and a threat
model in `docs/`. No customers, testimonials or benchmarks exist; none may be fabricated.

## Product Principles

1. State is never color alone: every status and node category has a shape, label or icon.
2. Control over the AI is visible: draft, review, publish and approval are first-class moments.
3. Failure is a designed state: errors, loading and empty states always keep orientation and a way forward.
4. Dense but calm: a tool for long sessions favors scanability and consistency over decoration.
5. Craft is the message: the interface should show product and UX judgment, not a template.

## Accessibility & Inclusion

Target WCAG 2.2 AA: text contrast, non-color status cues (1.4.1), 44 px touch targets, visible
focus, keyboard-operable editor controls, `prefers-reduced-motion` respected, light and dark
themes. Radix primitives and existing `aria-label` coverage are kept.
