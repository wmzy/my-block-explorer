---
name: Bug report
about: Something renders wrong, errors out, or shows data you cannot trust
labels: bug
---

**Explorer version** — the `version` field from `/api/health`, or the version chip in the top bar:

**Run mode** (keep one): RPC-only (no backend) · Local backend (`npx my-block-explorer --port 8201`) · Shared deployment

**Chain + RPC provider class** — chain name or id, and whether the chain rides viem's default public endpoint, a provider API key (Alchemy/Infura/…), or a self-run node (anvil/Hardhat/geth):

**Browser** (e.g. Firefox 141 on Linux):

**Steps to reproduce**:

1.
2.

**Expected**:

**Actual** (paste the exact error text where there is one):

<details>
<summary>Diagnostics — paste the <code>/api/health</code> payload and the Ops dashboard's "Copy diagnostics" JSON (Ops → Copy diagnostics)</summary>

```json
{
  "health": {},
  "opsDiagnostics": {}
}
```

</details>
