# ClawPanel directory packages

The OpenAI and Claude packages connect to ClawPanel’s hosted MCP service over HTTPS. To validate the Claude bundle locally, run `claude plugin validate --strict --profile directory ./plugins/claude` from the repository root.

Use `plugins/claude` as the plugin path in Anthropic’s developer portal. The hosted server has its own MCP connector submission. Pair the two submissions before publishing the plugin. [Claude plugin submission](https://claude.com/docs/plugins/submit) · [Claude connector submission](https://claude.com/docs/connectors/building/submission)

OpenAI reviews the complete package and scans the hosted tool metadata. Use a verified publisher organization and a global-residency API project. [OpenAI remote server requirements](https://developers.openai.com/plugins/deploy/app-review)

The packages request access to the hosted connector’s knowledge search and shared Work issue reads. The OpenAI manifest includes five positive and three negative review cases. Run those cases against a dedicated synthetic workspace in both native clients before submission.

Seed the review workspace with the knowledge source and issue named in the cases. Give the connected reviewer access to the issue and linked SOP. Seed the separate-workspace issue with the specified UUID and verify it is inaccessible to the reviewer. Revoke a separate test connection and confirm that it stops receiving workspace results.

Set the OpenAI domain challenge from the publisher dashboard on the MCP host. Add the recorded walkthrough and synthetic reviewer credentials through the relevant publisher portal. [Setup](https://clawpanel.app/workflow-guides/setup.md) · [Privacy](https://clawpanel.app/privacy) · [Terms and contact](https://clawpanel.app/terms)
