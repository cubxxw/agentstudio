// Explicitly loaded trusted Pi extension; no discovery or global settings writes.
export default async function agentRoomTools(pi) {
  const endpoint = process.env.AGENTROOM_TOOL_ENDPOINT, token = process.env.AGENTROOM_TOOL_TOKEN;
  if (!endpoint || !/^http:\/\/127\.0\.0\.1:\d+\/s\/[a-f0-9]+$/.test(endpoint) || !token) throw new Error('AgentRoom tool session is unavailable');
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const response = await fetch(endpoint, { headers });
  if (!response.ok) throw new Error('AgentRoom tool session is unavailable');
  const { tools } = await response.json();
  for (const tool of tools) pi.registerTool({ name: tool.name, label: tool.title || tool.name, description: tool.description, parameters: tool.inputSchema,
    async execute(toolCallId, args) {
      const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ name: tool.name, arguments: args, callId: `pi-${toolCallId}` }) });
      const body = await response.json(), result = response.ok ? body.result : body;
      return { content: [{ type: 'text', text: JSON.stringify(result) }], details: { success: response.ok } };
    },
  });
  pi.on('session_start', () => { pi.setActiveTools(tools.map(tool => tool.name)); });
}
