/**
 * Agent Command
 * Switch between agents using component-based UI
 */

import { AgentSelection } from "../../screens/chat/components/AgentSelection.js";
import { getAgentCompletions } from "../../completions/agent.js";
import type { Command } from "../types.js";

export const agentCommand: Command = {
	id: "agent",
	label: "/agent",
	description: "Switch between AI agents with different system prompts",
	args: [
		{
			name: "agent-name",
			description: "Agent to switch to (coder, planner, etc.)",
			required: false,
			loadOptions: async () => {
				return getAgentCompletions();
			},
		},
	],
	execute: async (context) => {
		const { getAllAgents, getAgentById } = await import("../../embedded-context.js");
		const { get } = await import("@sylphx/code-client");
		const {
			$selectedAgentId,
			$currentSessionId,
			setSelectedAgent,
			updateSessionAgent,
		} = await import("@sylphx/code-client");

		// If arg provided, switch directly
		if (context.args.length > 0) {
			const agentId = context.args[0];
			const agent = getAgentById(agentId);

			if (!agent) {
				return `Agent not found: ${agentId}. Use /agent to see available agents.`;
			}

			// Update global default (always)
			await setSelectedAgent(agentId);

			// Update current session if exists
			const currentSessionId = get($currentSessionId);
			if (currentSessionId) {
				await updateSessionAgent(currentSessionId, agentId);
			}

			return `Switched to agent: ${agent.metadata.name}\n${agent.metadata.description}`;
		}

		// No args - show agent selection UI
		const agents = getAllAgents();
		const selectedAgentId = get($selectedAgentId);
		const currentAgent = getAgentById(selectedAgentId);

		if (!currentAgent) {
			return "Current agent not found.";
		}

		if (agents.length === 0) {
			return "No agents available.";
		}

		const agentsList = agents.map((agent) => ({
			id: agent.id,
			name: agent.metadata.name,
			description: agent.metadata.description,
		}));

		// Use AgentSelection component
		context.setInputComponent(
			<AgentSelection
				agents={agentsList}
				currentAgentId={currentAgent.id}
				onSelect={async (agentId) => {
					const { get } = await import("@sylphx/code-client");
					const {
						$currentSessionId,
						setSelectedAgent,
						updateSessionAgent,
					} = await import("@sylphx/code-client");
					const selectedAgent = getAgentById(agentId);

					if (!selectedAgent) {
						context.addLog(`[agent] Agent not found: ${agentId}`);
						context.setInputComponent(null);
						return;
					}

					// Update global default (always)
					await setSelectedAgent(agentId);

					// Update current session if exists
					const currentSessionId = get($currentSessionId);
					if (currentSessionId) {
						await updateSessionAgent(currentSessionId, agentId);
					}

					context.addLog(`[agent] Switched to agent: ${selectedAgent.metadata.name}`);
					context.setInputComponent(null);
				}}
				onCancel={() => {
					context.setInputComponent(null);
					context.addLog("[agent] Agent selection cancelled");
				}}
			/>,
			"Agent Selection",
		);

		context.addLog("[agent] Agent selection opened");
	},
};

export default agentCommand;
