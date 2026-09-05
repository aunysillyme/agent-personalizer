# Companion tools

This repo tells an AI *how to behave with you*. Two companions govern *what it can touch* and *what it is allowed to carry*. Neither is required; both make the onboarding answers enforceable instead of advisory.

| Your answer in the interview | What enforces it without a companion | With a companion |
|---|---|---|
| **Always ask before** delete / publish / send / spend | the AI remembering | obsidian-tc: destructive tools fail closed until a human confirms |
| **Off limits** folders | the AI remembering | obsidian-tc: folder ACL deny, per caller |
| **Write policy** (freely / logs and inbox only / ask first) | the AI remembering | obsidian-tc: per-folder read / write / delete scopes; Context Layer: memory writes stay proposals until approved |
| **Evidence inline** | the AI citing what it read | Context Layer: every disclosure and action leaves a receipt |

---

## obsidian-tc (for Obsidian vaults)

**What it is.** A governed MCP server over Obsidian vaults: https://github.com/The-40-Thieves/obsidian-tc (AGPL-3.0). Its own README states the problem it exists for: an agent with raw filesystem access to a vault "can do real damage", and most Obsidian MCP servers hand that access over with an API key between the agent and everything you have written.

**What it adds** (its words, condensed):
- **Governed writes**: every call runs through auth → scopes → folder ACL → read-only kill switch → idempotency → throttle → human-in-the-loop confirmation → audit log. You decide which folders an agent may read, write or delete, per vault and per caller; destructive operations fail closed until a human approves.
- **Fused retrieval**: BM25 + vector + graph, fused and reranked, so "where did I say X" works across a large vault.
- **Memory that lives in the vault**: episodes, activation decay, explicit forgetting, under the same ACL as every other write.
- **Three meta-tools by default** (`find_capability`, `describe_capability`, `call_capability`) in front of ~163 capabilities, so the agent's context stays small.

**Try it**:
```bash
npx obsidian-tc /path/to/vault
```
Lexical search and every note tool work immediately; semantic and graph retrieval need an embeddings backend (Ollama by default). Also ships as a Docker image, an `.mcpb` bundle, and standalone binaries.

**How it pairs with this repo.** When you answer `notes_tool: obsidian`, the rendered `AGENT_ONBOARDING.md` tells the AI to reach the vault through obsidian-tc rather than the filesystem, and your **off-limits** and **always-ask** answers become the folder ACL and the human-in-the-loop list you configure there. Same intent, now enforced.

---

## The Context Layer (Sierra Catalina)

**What it is.** A specification and starter for purpose-bound context between you, your vault, and any agent: https://sierracatalina.com/context-layer. It is an architecture you adopt, with tested v0.2 contracts and a local proof profile you can run, not a package you install once.

**The shape** (from the page, condensed). Six stages: **capture** (record source, time, identity and a payload digest before interpretation) → **normalize** (derive structured claims with provenance and confidence) → **vault** (encrypted originals and policy state stay inside user-controlled authority; raw data never enters a bundle or a receipt) → **decide** (allow, reduce, approve or deny, by purpose, recipient, selectors, actions and expiry) → **bundle** (recipient-bound, expiring, single-use context with restrictions and provenance) → **act** (verify capabilities, execute the permitted action, append a minimized receipt; **memory writes remain proposals**). The receipt rail: request → decision → disclosure → action → writeback.

**Read in this order**: the [essay](https://sierracatalina.com/signal/the-context-layer) (the argument in plain language) → [architecture](https://sierracatalina.com/context-layer/architecture) → [specification](https://sierracatalina.com/context-layer/specification) → [implementation](https://sierracatalina.com/context-layer/implementation) → [code](https://sierracatalina.com/context-layer/code) (v0.2 contracts, encrypted local vault, four-state policy, scoped bundles, anchored receipts, a files adapter, a local-agent consumer) → [demo](https://sierracatalina.com/context-layer/demo). Its stated boundary: it does not claim production key custody or a portable signing suite.

**How it pairs with this repo.** Three of the interview's answers are Context Layer decisions in miniature:
- **Write policy** "logs and inbox only" or "ask before every write" is the Layer's rule that memory writes remain proposals until approved.
- **Off limits** is the Layer's vault stage: originals that never enter a bundle.
- **Always ask before** is the Layer's decide stage: allow, reduce, approve or deny by action and recipient.
Level 4 (several agents) is where it earns its keep: each delegation carries a purpose-bound bundle and returns a receipt, so you can answer "who saw what, and why" after the fact. The repo's `AGENT_ONBOARDING.md` is the human-readable policy; the Context Layer is how you make a machine enforce and record it.

---

## Reaching the other note tools

| `notes_tool` answer | How an AI reaches it | Write posture rendered into the onboarding file |
|---|---|---|
| `obsidian` | obsidian-tc (above), or the vault folder on disk | your write policy, enforced by obsidian-tc's ACL when configured |
| `logseq` / `folder` | the folder on disk | your write policy, under each folder's README |
| `notion` | Notion's own MCP connector | writes only into the pages or databases you name; the AI proposes new top-level pages, never creates them unasked |
| `google-docs` | the Google Drive / Docs connector | the AI drafts into a doc named for the topic and never edits a shared doc's existing text without being asked |
| `apple-notes` | a separately installed local Apple Notes MCP (no AI app ships one built in) | read, and create new notes; never edit or delete existing notes |
| `onenote` / `evernote` | no first-class agent door today | treated as a read-only source; the AI writes to a local fallback folder (`notes/`) and tells you what to paste back |
| `other` | you name the tool and the location | the AI asks before its first write there and uses the local fallback folder (`notes/`) until then |

None of these connectors ship in this repo. The onboarding file names the door; you connect it in your AI's own settings, where the app offers one. For cloud tools the onboarding file also says, explicitly, that none of these notes are local files, so the AI does not invent a folder named after your workspace.
