# Agent access through MCP and HTTP

Research checked 2026-09-16. These are standards findings and design recommendations for the feature interview, not an accepted implementation plan. Client compatibility still needs verification against the clients Dig chooses to support.

## Current standards

The current MCP revision is **2026-07-28**. The project labels current revisions ready for use and distinguishes them from drafts and final historical revisions. This revision supports per-request version declarations and `server/discover`; clients using the initialization handshake from 2025-11-25 or earlier need the documented compatibility path. Pin the selected revision in implementation and tests. [MCP versioning](https://modelcontextprotocol.io/docs/2026-07-28/learn/versioning)

The latest published OpenAPI specification is **3.2.1**, dated 2026-09-10. OpenAPI describes HTTP operations, parameters, schemas, responses, and security requirements. Its document version is separate from the version of Dig's API. OpenAPI can support generated documentation, clients, and validation; it does not decide Dig's access policy. Tooling compatibility should determine whether Dig initially publishes a 3.1 or 3.2 description. That last choice is a recommendation, not a standards requirement. [OpenAPI 3.2.1](https://spec.openapis.org/oas/v3.2.1.html)

## What MCP adds

MCP tools expose named operations with descriptions and JSON Schema inputs, plus optional output schemas and structured results. This fits operations such as finding Tasks, reading their context, capturing a Task, and posting a comment. The examples are proposed Dig uses. MCP resources expose URI-addressed context that the host application can choose to incorporate. A Task or Space workflow could be such a resource, but Dig does not need to expose every read through both mechanisms. [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools), [resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)

Annotations such as `readOnlyHint`, `destructiveHint`, and `idempotentHint` describe expected tool behavior. They are hints and carry no enforcement guarantee. Recommendation: Dig must enforce permissions and retry behavior in its own operations; a tool marked read-only cannot replace an access check. [Tool annotations](https://modelcontextprotocol.io/specification/2026-07-28/schema#toolannotations)

For remote access, Streamable HTTP provides an independent server and one POST endpoint. The current revision can return JSON or request-scoped SSE; it removed protocol-level sessions and the separate GET stream endpoint. It requires Origin validation when Origin is present. Avoid implementing the deprecated 2024 HTTP+SSE transport for a new server. [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)

With stdio, the client starts a local subprocess and exchanges JSON-RPC over stdin/stdout. Logs belong on stderr. Recommendation: a local stdio adapter could call Dig's remote API when a chosen client requires it, but that adds installation and credential handling. Hosted HTTP is the cleaner starting point if the required clients support it. [stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)

## Authorization decisions

MCP's HTTP authorization specification treats the MCP server as an OAuth resource server. It requires audience validation and bearer tokens in the Authorization header on every request; tokens must not travel in URL query strings. Tokens issued for an unrelated upstream service cannot simply be passed through. The authorization server may be separate from Dig. MCP references an OAuth 2.1 draft, so describe it accurately rather than calling OAuth 2.1 a published RFC. [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

Protected Resource Metadata advertises authorization servers. Clients discover authorization endpoints through OAuth metadata or OpenID Connect discovery. Authorization-code clients must use PKCE and verify advertised PKCE support. Recommendation: assess Dig's existing identity provider against these requirements; existing browser sign-in alone is insufficient evidence of agent compatibility. [Discovery](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery), [authorization security](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations)

Current MCP supports pre-registration and recommends Client ID Metadata Documents. Dynamic Client Registration remains a deprecated compatibility option. Recommendation: select registration support after choosing initial clients; do not assume every client supports every option. [Client registration](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration)

## Retries, conflicts, and API contracts

HTTP defines idempotent methods and advises against automatically retrying non-idempotent requests without knowing repetition is safe. `If-Match` supports conditional changes that prevent overwriting concurrent edits. Recommendation: preserve Dig's existing command receipts and revision checks in agent operations, and document their lifetime and conflict responses. A lost response after creating a Task must not create another Task on retry. [HTTP semantics, sections 9.2.2 and 13.1.1](https://www.rfc-editor.org/rfc/rfc9110.html)

The proposed `Idempotency-Key` header specification currently appears as an **expired Internet-Draft**, not a published RFC. Dig can define its own documented retry contract without claiming that draft is an adopted standard. [IETF draft status](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)

RFC 9457 defines machine-readable problem details for HTTP errors. Recommendation: consider it for a public API while mapping errors to MCP's result format in the MCP adapter. [Problem details](https://www.rfc-editor.org/rfc/rfc9457.html)

## Codex compatibility

The user selected Codex as the primary client. OpenAI's current MCP documentation supports direct stdio and Streamable HTTP connections on a Codex host, with bearer-token or OAuth authentication, including CIMD and DCR. It documents shared MCP configuration for the desktop app, CLI, and IDE extension on the same host, with user configuration in `~/.codex/config.toml` and project configuration in trusted `.codex/config.toml` files. The current documentation calls the desktop product ChatGPT desktop app. It describes adding a server and authenticating through both desktop and IDE settings. Hosted plugin tools have a separate capability boundary. [Official OpenAI MCP documentation](https://developers.openai.com/codex/mcp)

Local verification on 2026-09-16 found `codex-cli 0.154.0`. Its `codex mcp add --help` exposes `--url`, `--bearer-token-env-var`, `--oauth-client-id`, `--oauth-resource`, and `--oauth-client-registration` with `auto`, `cimd`, or `dcr`. `codex mcp login --help` exposes `--scopes`. These checks confirm configuration options, not a successful Dig connection.

Codex cloud runs Tasks in separately configured cloud environments. Recommendation: treat cloud support as a separate compatibility target, including network access and credentials; do not infer it from local CLI support or assume it inherits local configuration. The fetched cloud overview does not establish equivalent direct MCP setup. [Codex cloud](https://developers.openai.com/codex/cloud)

Recommendation: use hosted Streamable HTTP for the first Codex trial. Record the exact client, version, authentication flow, and MCP revision that pass that trial. Interoperability with MCP **2026-07-28 remains untested**; the client documentation's mention of initialization does not establish support for that revision's changed discovery and transport behavior.

## Recommendations to test in the interview

Start with the work an agent should finish. Reading and summarizing a Space, maintaining Tasks during a coding session, and running unattended triage imply different permissions and identities.

I recommend shared Dig operations behind an HTTP API and an MCP adapter. Keep permission checks, revision conflicts, idempotency, and audit attribution consistent across both. Decide whether an agent acts for a person or has a separate automation identity, which Spaces it may access, how grants are revoked, and which changes require approval. These are product decisions; neither MCP nor OpenAPI answers them.

A useful first contract should identify supported clients and versions, allowed reads and writes, pagination limits, identity attribution, retry rules, and what happens when a human edits the same Task. Event subscriptions and unattended execution should follow demonstrated workflows rather than becoming automatic requirements.
