import type { DocArticle } from "./types";

export const integrationsArticles: DocArticle[] = [
  {
    slug: "integrations-overview",
    categorySlug: "integrations",
    title: "Integrations & API Overview",
    description: "Connect Skillmark with ATS platforms, webhooks, and AI automation tools",
    audience: "creators",
    order: 1,
    content: () => (
      <>
        <h2>Overview</h2>
        <p>
          Skillmark supports seamless integration with applicant tracking systems (ATS), automation platforms like Zapier and Make, custom backend systems, and external AI agents.
        </p>

        <h3>Available Integration Channels</h3>
        <ul>
          <li>
            <strong>API Keys</strong> — Authenticate REST requests using <code>Bearer dlv_...</code> tokens to ingest candidates and trigger interview sessions.
          </li>
          <li>
            <strong>Interview Forms</strong> — Generate shareable applicant application forms connected directly to specific interview pipelines.
          </li>
          <li>
            <strong>Inbound & Outbound Webhooks</strong> — Receive real-time HMAC-signed events when candidates are invited or complete their interviews.
          </li>
          <li>
            <strong>Model Context Protocol (MCP)</strong> — Connect AI assistants to interview management tools via our standard MCP server.
          </li>
        </ul>
      </>
    ),
  },
];
