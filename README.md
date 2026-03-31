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
wui portfolio            # Print portfolio table
wui portfolio --json     # JSON output
wui activity             # Print recent transactions
wui activity --json      # JSON output
wui send <addr> <amt> <symbol>  # Send tokens (e.g. SOL, USDC)
wui config               # Re-run setup
wui --help               # Usage info
```

## Wallet management

wui can create new wallets or import existing Solana CLI keypair files. Wallet data is stored at `~/.wui/`:

- `wallets.json` — wallet registry (labels, public keys, encrypted key file paths — no secrets)
- `keys/` — encrypted wallet vault files owned by `wui`

Imported Solana CLI keypair files are copied into `~/.wui/keys/`, encrypted, and then managed by `wui`.

On first launch after upgrading from the older plaintext wallet format, `wui` will guide you through a one-time in-app migration.

Private keys never leave your machine and are not stored in plaintext by `wui`.

## Requirements

- Node.js 20+
- A Solana RPC endpoint
- A Jupiter API key (free)

## License

MIT
