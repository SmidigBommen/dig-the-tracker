# Connect Codex to Dig

Slice 11 provides read-only MCP access. Codex can read selected Spaces, Tasks, discussion, history, Tags, and workflow. It cannot change work, read your inbox, or administer Dig. You can close Codex whenever you like; Dig does not depend on an agent being connected.

## Create a connection

1. A Space administrator opens **Manage Space → Agent access** and enables access. It starts disabled.
2. Open **Personal menu → Agent connections**. Give the connection a recognisable name and select its Spaces.
3. Create the connection and save the token in your password manager. Dig shows it once and stores only its hash. It expires after 30 days.

The connection acts as your existing Dig identity. Third-party login remains the way you manage your account. Each connection has a stable ID; the token is the secret that proves access, rather than a public identifier being treated as a password.

## Codex CLI

Use the public HTTPS address of your Dig installation. Set the token outside source files and shell history. In macOS zsh:

```zsh
read -rs 'DIG_TOKEN?Dig token: '; echo
export DIG_TOKEN
codex mcp add dig --url https://YOUR-DIG-HOST/mcp --bearer-token-env-var DIG_TOKEN
codex mcp get dig
codex
```

Paste the token into the hidden prompt. The `mcp add` command stores the environment variable's name, not its value. Start Codex from that shell, then ask it to read a Task such as `Show DIG-42 using Dig`.

After closing Codex, `unset DIG_TOKEN` clears it from that shell. For repeated use, retrieve it from your password manager into the launching process. Avoid storing the value in `config.toml`, a checked-in `.env`, a skill, or a shell startup file.

## Codex desktop

The endpoint and bearer environment variable use the same Codex MCP configuration:

```toml
[mcp_servers.dig]
url = "https://YOUR-DIG-HOST/mcp"
bearer_token_env_var = "DIG_TOKEN"
```

The desktop process must inherit `DIG_TOKEN` when it launches. Opening an already-running app from a terminal does not replace its environment; a Finder launch normally has a different environment from your shell. Configure the token through your supported Codex MCP settings or launch the executable from an environment supplied by your credential manager. Do not put the token itself in configuration. See [Codex MCP configuration](https://developers.openai.com/codex/mcp) for current client options.

Actual desktop interaction remains a manual compatibility gate; CLI and independent-client results are recorded in the [implementation notes](implementation/slice-11-agent-read-access.md). Do not infer desktop verification from a shared configuration format.

## Optional local skill

Copy the bundled `skills/dig` directory into your personal Codex skills directory, usually `~/.codex/skills/dig`. Review an existing installation before replacing it. Restart or refresh Codex's skill discovery, then invoke `$dig show DIG-42`.

The skill uses the configured MCP tools and contains no credentials. Its current mode reads context. `$dig work` does not claim or update work until later slices add those operations.

## Replace or revoke access

**Replace token** invalidates the previous token immediately and starts a fresh 30-day lifetime. Save the new token and update the environment that launches Codex. It preserves the original selected Spaces and read-only scope.

**Revoke** ends a connection immediately. To resume, create a new one. Removing a Member, disabling agent access, or archiving a Space prevents further reads. Re-inviting a Member or disabling and re-enabling access does not revive old grants; create a new connection to grant those Spaces again. Restoring an archived Space restores the grant if membership and policy have not changed.

Last-use time means a request authenticated. It is not online status. No scheduled ping, heartbeat comment, or always-running listener is needed.

## Troubleshooting

- **401:** missing, expired, replaced, or revoked token. Check Agent connections, then restart Codex with the correct token environment variable.
- **403 / Space unavailable:** verify membership, the selected Spaces, and the administrator's Agent access setting. Create a new connection after membership or policy invalidation.
- **429:** wait for `Retry-After`. Adding connections does not increase the person's request allowance.
- **Cursor expired:** the Board changed while paging. Restart the search or discussion page.
- **Request or response too large:** reduce page sizes. Each read accepts at most 50 items per page.

Dig accepts bearer tokens at `/mcp` only. Browser cookies do not authenticate MCP, and credentials in query strings are rejected. The existing browser HTTP endpoints remain private application interfaces, not a supported public API.
