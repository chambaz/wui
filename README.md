# wui

A Solana wallet for the terminal.

## Install

Install globally to get the `wui` command:

```bash
npm install -g @chambaz/walletui
```

Then run from anywhere:

```bash
wui
```

## Setup

On first run, wui will prompt you for:

1. **Solana RPC URL** — a paid RPC endpoint (e.g. [Helius](https://helius.dev))
2. **Jupiter API Key** — free key from [portal.jup.ag](https://portal.jup.ag)

Config is saved to `~/.wui/.env`. Re-run setup anytime with `wui config`.

## Usage

### Keyboard shortcuts

| Key | Action                 |
| --- | ---------------------- |
| `p` | Portfolio screen       |
| `s` | Swap screen            |
| `t` | Transfer screen        |
| `a` | Activity screen        |
| `w` | Wallets screen         |
| `k` | Staking screen         |
| `r` | Refresh current screen |
| `q` | Quit                   |

Each screen has context-specific shortcuts shown at the bottom.

### CLI commands

```bash
wui                           # Launch interactive TUI
wui portfolio            # Print portfolio table
wui activity             # Print recent transactions
wui wallet current       # Show the active wallet
wui wallet list          # List available wallets
wui wallet use <label|pubkey>   # Switch the active wallet
wui send <addr> <amt> <token>   # Send tokens (e.g. SOL, USDC)
wui swap <amt> <from> <to>      # Swap tokens (e.g. SOL -> USDC)
wui wrap <amt|max>       # Wrap native SOL into WSOL
wui unwrap               # Unwrap standard WSOL
wui stake list           # Show native and liquid staking positions
wui stake native <amt> <validator-label|vote-account>
wui stake liquid <amt> <provider-label|pool-address|lst-mint>
wui unstake native deactivate <stake-account>
wui unstake native withdraw <stake-account> <amt|max>
wui unstake liquid <amt|max> <provider>
wui config               # Re-run setup
wui --help               # Usage info
```

Add `--json` to supported non-interactive commands for JSON output.

Run `wui <command> --help` for command-specific help and examples.

## Wallet management

wui can create new wallets or import existing Solana CLI keypair files. Wallet data is stored at `~/.wui/`:

Wallet creation and import currently happen in the interactive TUI.

- `wallets.json` — wallet registry (labels, public keys, encrypted key file paths — no secrets)
- `keys/` — encrypted wallet vault files owned by `wui`

Imported Solana CLI keypair files are copied into `~/.wui/keys/`, encrypted, and then managed by `wui`.

Private keys never leave your machine and are not stored in plaintext by `wui`.

## Requirements

- Node.js 20+
- A Solana RPC endpoint
- A Jupiter API key (free)

## License

MIT
