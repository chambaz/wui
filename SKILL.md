---
name: wui-agent
description: >
  Use for Solana wallet tasks via the `wui` terminal CLI, including switching
  wallets, reading portfolio/activity/staking state, sending tokens, swapping
  assets, wrapping or unwrapping SOL, and managing native or liquid staking
  positions. Prefer this skill whenever the user wants the AI agent to operate
  their local `wui` wallet through the CLI. Check `wui auth status --json`
  before state-changing commands, and if no session is active, instruct the
  user to run `wui auth unlock` manually.
compatibility: Requires local `wui` CLI access and a same-machine auth session for state-changing commands.
---

# WUI Agent

Use `wui` for all wallet based actions. Do not reimplement wallet logic, quote logic, swap routing, or staking behavior.

## Installation

If `wui` is not installed, instruct the user to install it globally with npm:

```bash
npm install -g @chambaz/walletui
```

After installation, confirm the CLI is available:

```bash
wui --help
```

## Initial setup

If the user has not configured `wui` yet, guide them through first-run setup.

### 1. Configure RPC and Jupiter API key

Run:

```bash
wui config
```

This sets up the required environment at `~/.wui/.env`.

### 2. Create or import a wallet

Open the TUI:

```bash
wui
```

Then use the Wallets screen:

- `[w]` to open Wallets
- `[c]` to create a wallet
- `[i]` to import a wallet

Once a wallet exists, confirm the active wallet from the CLI:

```bash
wui wallet current --json
```

### 3. Unlock an auth session for agent-driven actions

Before the AI agent performs state-changing commands, the user should manually unlock a same-machine auth session:

```bash
wui auth unlock
```

Confirm session state with:

```bash
wui auth status --json
```

## Operating model

- Use `wui ... --json` for machine-readable CLI output whenever possible.
- For read-only inspection, run the relevant `wui` command directly.
- For state-changing actions, first check `wui auth status --json`.
- If auth is inactive, stop and tell the user to run `wui auth unlock` manually.
- Once auth is active and the user request is clear, execute the requested action directly.

The user manually unlocking `wui auth` is the authorization boundary for agent-driven wallet actions.

## Safety rules

- Never ask the user to paste private keys or passphrases into chat.
- Never bypass `wui` by constructing raw blockchain transactions yourself.
- Never invent token mints, recipient addresses, validator vote accounts, stake pool addresses, or wallet labels.
- If a request is missing critical execution details, ask one short clarifying question.
- If a selector is ambiguous, prefer explicit identifiers like mint address, token account address, wallet pubkey, validator vote account, or stake account address.
- After state-changing commands, report the result clearly and include the transaction signature.

## Read-only commands

Use these for inspection and planning:

```bash
wui wallet current --json
wui auth status --json
wui portfolio --json
wui activity --json
wui stake list --json
```

## Execution commands

Use these once auth is active and the user intent is clear:

```bash
wui wallet use <label|pubkey> --json
wui send <address> <amount|max> <token> --json
wui swap <amount|max> <from> <to> --json
wui wrap <amount|max> --json
wui unwrap --json
wui stake native <amount> <validator-label|vote-account> --json
wui stake liquid <amount> <provider-id|pool-address|lst-mint> --json
wui unstake native deactivate <stake-account> --json
wui unstake native withdraw <stake-account> <amount|max> --json
wui unstake liquid <amount|max> <provider-id|pool-address|lst-mint> --json
```

## Workflow

### 1. Resolve context

For wallet actions, first understand:

- active wallet
- whether auth session is active
- relevant balances or staking positions

Recommended sequence:

```bash
wui wallet current --json
wui auth status --json
```

Then inspect only what is needed:

- `wui portfolio --json` for send, swap, wrap, unwrap
- `wui stake list --json` for stake and unstake flows
- `wui activity --json` when the user asks about recent history

### 2. Decide if clarification is needed

Ask a short clarification only when execution would otherwise be unsafe or ambiguous.

Examples:

- missing recipient address for a transfer
- ambiguous source token in wallet
- native unstake requested without specifying which stake account
- liquid unstake requested when provider is unclear

If the user request is already explicit enough, do not add unnecessary planning chatter.

### 3. Check auth for state-changing commands

Before any mutation, run:

```bash
wui auth status --json
```

If inactive, stop and tell the user:

```bash
wui auth unlock
```

Do not attempt to handle passphrase entry through chat.

### 4. Execute via `wui`

Run the smallest correct command.

Examples:

- swap 0.1 SOL for JitoSOL:
  - `wui swap 0.1 SOL JitoSOL --json`
- send 25 USDC:
  - `wui send <address> 25 USDC --json`
- unwrap standard WSOL:
  - `wui unwrap --json`
- unstake from Jito:
  - `wui unstake liquid max jito --json`

### 5. Report clearly

For successful actions, report:

- what was executed
- wallet or position affected if relevant
- transaction signature

For failures, surface the `error` from JSON output directly and suggest the minimum useful next step.

## Command-specific guidance

### Wallet switching

- Inspect current wallet with `wui wallet current --json`.
- Switch with `wui wallet use <label|pubkey> --json`.
- After switching, re-check `wui auth status --json` because the auth session is wallet-specific.

### Sending tokens

- Use `wui portfolio --json` if you need to confirm balances first.
- The `<token>` selector can be a symbol, mint, or exact token account address.
- For SOL vs WSOL ambiguity, prefer `SOL` or `WSOL` explicitly.

### Swapping

- Use `wui swap <amount|max> <from> <to> --json`.
- For source-token ambiguity, prefer explicit selectors.
- The destination token may be a symbol or mint.

### Wrap and unwrap

- `wui wrap <amount|max> --json`
- `wui unwrap --json`

Unwrap operates on the standard WSOL account only. If `wui` returns an error explaining that only the standard account is supported, relay that directly to the user.

### Native staking

- Inspect with `wui stake list --json`.
- Create stake with:
  - `wui stake native <amount> <validator-label|vote-account> --json`
- Native unstake is a two-step lifecycle:
  - `wui unstake native deactivate <stake-account> --json`
  - later, after deactivation completes:
  - `wui unstake native withdraw <stake-account> <amount|max> --json`

### Liquid staking

- Stake with:
  - `wui stake liquid <amount> <provider-id|pool-address|lst-mint> --json`
- Unstake with:
  - `wui unstake liquid <amount|max> <provider-id|pool-address|lst-mint> --json`

Use provider ids like `jito` when clear; otherwise prefer exact pool address or LST mint.

## Examples

### Example: swap after manual unlock

User: `Swap 0.2 SOL for JitoSOL`

Agent flow:

1. `wui auth status --json`
2. If inactive: tell user to run `wui auth unlock`
3. Once active: `wui swap 0.2 SOL JitoSOL --json`
4. Report the signature and outcome

### Example: send to a friend

User: `Send 20 USDC to 5abc...xyz`

Agent flow:

1. `wui auth status --json`
2. If active: `wui send 5abc...xyz 20 USDC --json`
3. Report result and signature

### Example: unstake native position

User: `Unstake my native stake`

Agent flow:

1. `wui stake list --json`
2. If multiple native stake accounts exist, ask which stake account to target
3. If the selected account is still active, run deactivation
4. If it is already deactivated, run withdrawal

## Failure handling

- If `wui` returns `{ "error": ... }`, treat that as the source of truth.
- Prefer relaying the exact actionable error rather than paraphrasing it heavily.
- If auth expired mid-flow, tell the user to run `wui auth unlock` again and then retry the command.
