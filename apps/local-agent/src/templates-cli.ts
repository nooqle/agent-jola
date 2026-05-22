import {
  buildLocalAgentPrompt,
  buildLocalAgentPromptFromTemplate,
  getStrategyPromptTemplate,
  listStrategyPromptTemplates
} from "@agent-bomber/strategy";
import { AgentPoppyClient, envValueAny } from "./client.js";

type TemplateCommand = "list" | "show" | "prompt" | "apply" | "help";

interface ParsedArgs {
  command: TemplateCommand;
  templateId: string | undefined;
  agentName: string | undefined;
  strategyText: string | undefined;
}

const args = parseArgs(process.argv.slice(2));

switch (args.command) {
  case "list":
    printTemplateList();
    break;
  case "show":
    printTemplate(args.templateId);
    break;
  case "prompt":
    printLocalAgentPrompt(args.templateId, args.agentName);
    break;
  case "apply":
    await applyTemplate(args.templateId, args.agentName, args.strategyText);
    break;
  case "help":
    printHelp();
    break;
}

function parseArgs(argv: string[]): ParsedArgs {
  const command = normalizeCommand(argv[0]);
  const templateId = command === "list" || command === "help" ? undefined : argv[1];
  return {
    command,
    templateId,
    agentName:
      optionValue(argv, "--agent") ??
      envValueAny(["AGENT_JOLA_AGENT_NAME", "AGENT_POPPY_AGENT_NAME"], "Local Agent"),
    strategyText: optionValue(argv, "--strategy")
  };
}

function normalizeCommand(value: string | undefined): TemplateCommand {
  if (value === "show" || value === "prompt" || value === "apply" || value === "help") return value;
  return "list";
}

function optionValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function printTemplateList(): void {
  console.log("Agent Jola strategy prompt templates:");
  for (const template of listStrategyPromptTemplates()) {
    console.log(`- ${template.id}: ${template.title} (${template.tag})`);
    console.log(`  ${template.summary}`);
  }
  console.log("");
  console.log("Commands:");
  console.log("  pnpm agent:template show safeAttack");
  console.log("  pnpm agent:template prompt zoneHunter --agent Ember");
  console.log("  pnpm agent:template apply survivor --agent Ember");
}

function printTemplate(templateId: string | undefined): void {
  const template = requireTemplate(templateId);
  console.log(`${template.title} (${template.id})`);
  console.log(template.summary);
  console.log("");
  console.log(template.prompt);
}

function printLocalAgentPrompt(
  templateId: string | undefined,
  agentName: string | undefined
): void {
  const template = requireTemplate(templateId);
  console.log(buildLocalAgentPromptFromTemplate(template.id, agentName ? { agentName } : {}));
}

async function applyTemplate(
  templateId: string | undefined,
  agentName: string | undefined,
  strategyText: string | undefined
): Promise<void> {
  const template = templateId ? requireTemplate(templateId) : undefined;
  const nextStrategy = strategyText ?? template?.prompt;
  if (!nextStrategy) {
    throw new Error("apply requires a template id or --strategy text.");
  }

  const client = new AgentPoppyClient();
  const agent =
    template && !strategyText
      ? await client.applyStrategyTemplate(
          agentName ? { templateId: template.id, name: agentName } : { templateId: template.id }
        )
      : await client.upsertProfileAgent(
          agentName
            ? { name: agentName, strategyText: nextStrategy }
            : { strategyText: nextStrategy }
        );
  console.log(`Applied strategy to ${agent.name} (${agent.id}).`);
  console.log("");
  console.log(
    buildLocalAgentPrompt({
      agentName: agent.name,
      battlePlan: nextStrategy
    })
  );
}

function requireTemplate(templateId: string | undefined) {
  if (!templateId) {
    printHelp();
    throw new Error("Missing template id.");
  }
  const template = getStrategyPromptTemplate(templateId);
  if (!template) {
    const ids = listStrategyPromptTemplates()
      .map((candidate) => candidate.id)
      .join(", ");
    throw new Error(`Unknown template "${templateId}". Available templates: ${ids}.`);
  }
  return template;
}

function printHelp(): void {
  console.log(`Agent Jola template CLI

Usage:
  pnpm agent:templates
  pnpm agent:template show <templateId>
  pnpm agent:template prompt <templateId> --agent <name>
  pnpm agent:template apply <templateId> --agent <name>
  pnpm agent:template apply --strategy "先保命，进圈后再压制最近对手" --agent Ember

Templates:
${listStrategyPromptTemplates()
  .map((template) => `  ${template.id.padEnd(12)} ${template.title}`)
  .join("\n")}
`);
}
