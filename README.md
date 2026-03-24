# wui

A Solana wallet for the terminal.

## Install

```bash
npm install -g walletui
```

Or run directly:

```bash
npx walletui
```

After installing, run the CLI with:

```bash
wui
```

## Setup

On first run, wui will prompt you for:

1. **Solana RPC URL** — a paid RPC endpoint (e.g. [Helius](https://helius.dev))
2. **Jupiter API Key** — free key from [portal.jup.ag](https://portal.jup.ag)

Config is saved to `~/.wui/.env`. Re-run setup anytime with `wui config`.

## Usage

Launch the interactive TUI:

```bash
wui
```

### Keyboard shortcuts

| Key | Action                 |
| --- | ---------------------- |
| `p` | Portfolio screen       |
| `s` | Swap screen            |
| `t` | Transfer screen        |
| `a` | Activity screen        |
| `w` | Wallets screen         |
| `r` | Refresh current screen |
| `q` | Quit                   |

Each screen has context-specific shortcuts shown at the bottom.

### CLI commands

```bash
wui portfolio            # Print portfolio table
wui portfolio --json     # JSON output
wui activity             # Print recent transactions
wui activity --json      # JSON output
wui send <addr> <amt> <token>   # Send tokens
wui config               # Re-run setup
wui --help               # Usage info
```

## Wallet management

wui can create new wallets or import existing Solana CLI keypair files. Wallet data is stored at `~/.wui/`:

- `wallets.json` — wallet registry (labels, public keys, paths — no secrets)
- `keys/` — generated keypair files (Solana CLI format)

Private keys never leave your machine.

## Requirements

- Node.js 20+
- A Solana RPC endpoint
- A Jupiter API key (free)

## License

MIT
