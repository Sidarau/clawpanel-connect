# ClawPanel directory packages

The OpenAI and Claude packages connect to ClawPanel’s hosted MCP service over HTTPS. To validate the Claude bundle locally, run `claude plugin validate --strict --profile directory ./plugins/claude` from the repository root.

Use `plugins/claude` as the plugin path in Anthropic’s developer portal. The hosted server has its own MCP connector submission. Pair the two submissions before publishing the plugin. [Claude plugin submission](https://claude.com/docs/plugins/submit) · [Claude connector submission](https://claude.com/docs/connectors/building/submission)

OpenAI reviews the complete package and scans the hosted tool metadata. Use a verified publisher organization and a global-residency API project. [OpenAI remote server requirements](https://developers.openai.com/plugins/deploy/app-review)

The manifests currently describe the development connector’s knowledge search and source reads. Before a release with Work and SOP access, confirm the published tool metadata and examples against the production endpoint using a synthetic workspace. Run the same three scenarios in both native clients.

1. Open the release-review issue and its linked SOP. Return the issue identifier, required reviewer action, and source citation.
2. Try to open the similarly named private issue in a second workspace. Confirm the grant prevents its title, content, and activity from being returned.
3. Revoke the connector and call the same read again. Confirm both clients stop receiving workspace results and request a fresh connection.

Use the publisher’s submission portal to provide synthetic review credentials. [Setup](https://clawpanel.app/workflow-guides/setup.md) · [Privacy](https://clawpanel.app/privacy) · [Terms and contact](https://clawpanel.app/terms)
