/** Copy-paste MCP client configs. Always uses a placeholder, never a real key. */
export const MCP_KEY_PLACEHOLDER = "rsi_live_YOUR_KEY";

export function mcpConfigs(serverUrl: string) {
  const header = `Bearer ${MCP_KEY_PLACEHOLDER}`;
  const cursor = JSON.stringify(
    {
      mcpServers: {
        "resiliencesoft-interview": {
          url: serverUrl,
          headers: { Authorization: header },
        },
      },
    },
    null,
    2,
  );
  // Claude Desktop runs local (stdio) servers from its config file, so it
  // reaches a remote server through the mcp-remote bridge.
  const claude = JSON.stringify(
    {
      mcpServers: {
        "resiliencesoft-interview": {
          command: "npx",
          args: ["-y", "mcp-remote", serverUrl, "--header", "Authorization:${AUTH_HEADER}"],
          env: { AUTH_HEADER: header },
        },
      },
    },
    null,
    2,
  );
  const claudeCode = `claude mcp add --transport http resiliencesoft-interview ${serverUrl} --header "Authorization: ${header}"`;
  return { cursor, claude, claudeCode };
}
