# Tethered Trust Launch

Release day for an MCP server or paid agent API, in one step. Add it to your release workflow and every new version:

1. **Is checked as an MCP client**: connects, lists tools, checks every schema and description. The job fails if the server is broken (set `fail-on: never` to only report).
2. **Is published to the [official MCP Registry](https://registry.modelcontextprotocol.io)** with this release's version. Glama, PulseMCP and other directories import from the registry.
3. **Has its x402 payments checked**: does each paid endpoint answer 402 with a payment request an agent can actually pay (token EIP-712 domain read from the chain, network, amount, CORS headers, Bazaar metadata).
4. **Is confirmed on npm and PyPI** if you publish client packages.
5. **Is sent to Bing and other IndexNow search engines.**
6. **Gets a listings report**: where it's found (registry, Glama, x402 Bazaar, npm, PyPI, your discovery files) and what's stale.

Everything runs in your workflow with your own credentials. No Tethered Trust account is needed; checks beyond the free daily allowance can use an API key with credits.

## Use

```yaml
name: release
on:
  release:
    types: [published]
permissions:
  contents: read
  id-token: write   # registry sign-in with GitHub OIDC (no secrets)
jobs:
  launch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: tetheredtrust/launch-action@v1
        with:
          url: https://mcp.example.com/mcp
          server-json: server.json
          x402-endpoints: |
            POST https://api.example.com/v1/quote
          npm: example-mcp
```

### Registry sign-in

| Your server.json `name` | Set | Needs |
|---|---|---|
| `io.github.<owner>/<name>` | `registry: github-oidc` (default) | `permissions: id-token: write` |
| `com.example/<name>` (your domain) | `registry: dns` or `registry: http` | `registry-domain` and `registry-private-key` (from a secret); the public key in a DNS TXT record or at `/.well-known/mcp-registry-auth` |
| Don't publish | `registry: none` | |

Generate a domain key with `openssl genpkey -algorithm Ed25519` (see the [registry docs](https://github.com/modelcontextprotocol/registry)). Rather not manage keys? [Tethered Trust publishes for you](https://tetheredtrust.com/launch/plan).

## Inputs

| Input | What |
|---|---|
| `url` | Your MCP server's public endpoint |
| `server-json` | Path to server.json (default `server.json`); its version is set to the release version |
| `registry` | `github-oidc`, `dns`, `http` or `none` |
| `registry-domain`, `registry-private-key` | For `dns` / `http` |
| `version` | Defaults to the release tag without a leading `v` |
| `x402-endpoints` | Paid endpoints, one per line; prefix `POST ` for POST endpoints |
| `npm`, `pypi` | Package names to confirm the version reached them |
| `indexnow-key`, `indexnow-urls` | Your IndexNow key (served at `/<key>.txt`) and the pages to submit |
| `api-key` | Optional Tethered Trust key with credits |
| `fail-on` | `broken` (default) or `never` |

Outputs: `result` (`pass`, `warn`, `fail`) and `registry-published`. A summary table is written to the job summary.

## Between releases

Directories drop listings and payment setups break without a release. The [Launch Plan](https://tetheredtrust.com/launch/plan) runs these checks every day and posts to your webhook when something changes. The [launch playbook](https://tetheredtrust.com/launch/playbook) covers every place an agent tool needs to be.

MIT licensed. Checks are informational; see the [API terms](https://tetheredtrust.com/api-terms).
