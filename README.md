# alexa-skill-mcp-bridge

Test your MCP server on a physical Echo as if it were an Alexa+ add-on, before you have access to Amazon's Alexa+ add-on tooling.

You put your MCP server URL into one config file, run a generator that turns the server's tools into an Alexa interaction model, deploy one CDK stack, deploy the Alexa skill with the ASK CLI, and talk to your MCP server through an Echo. An agent on Amazon Bedrock AgentCore Runtime (Strands Agents, Amazon Nova 2 Lite) does what the Alexa+ orchestrator would do: picks the tool, fills arguments, handles elicitation, turns tool results into short spoken answers, and keeps conversation context.

**This bridge reproduces the mechanics of an Alexa+ MCP client, not Alexa's own model judgment.** Tool choice, argument filling, and phrasing come from Nova 2 Lite with the prompts in this repo. Alexa+ will behave differently.

Full documentation lands in the docs pass (Phase 7 of [EXECUTION-PLAN.md](EXECUTION-PLAN.md)). Until then, [CLAUDE.md](CLAUDE.md) describes the layout and commands, and the [brief](alexa-skill-mcp-bridge-brief.md) describes the design.

## Tear down

`npm run destroy` removes the CDK stack and its ECR images. The Alexa skill stays in your developer account; delete it with `ask smapi delete-skill --skill-id <id>`.

License: Apache-2.0.
