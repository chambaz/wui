# AGENTS.md — wui

wui — Solana wallet for the terminal.
Terminal-native Solana wallet built with TypeScript, React, and Ink (React renderer for CLIs).
Targets developers and power users who prefer keyboard-driven terminal workflows.

## Build & Run Commands

```bash
# Package manager: pnpm (required — lockfile is pnpm-lock.yaml)
pnpm install

# Development (runs with tsx, no build step)
pnpm dev

# Development with CLI args
pnpm dev -- portfolio
pnpm dev -- activity --json
pnpm dev -- send <addr> <amount> <token>

# Production build (tsup, outputs ESM to dist/)
pnpm build

# Run built binary
pnpm start
# or: node dist/index.js
```

## Testing

There is no test framework configured yet. No test files exist.
When adding tests, follow this convention:

- Use **vitest** (aligns with the ESM + TypeScript + tsup stack).
- Place test files adjacent to source: `src/wallet/index.test.ts`.
- Name pattern: `*.test.ts` / `*.test.tsx`.

## Linting & Formatting

No linter or formatter is configured (no eslint, prettier, or biome).
When adding one, prefer **Biome** for zero-config speed, or ESLint + Prettier if the project opts in.
Until then, follow the existing code style described below exactly.

## TypeScript

- Config: `tsconfig.json` — strict mode enabled.
- Target: ES2022, module: ESNext, moduleResolution: bundler.
- JSX: `react-jsx` (no `import React from "react"` needed by the compiler, but the codebase does import React explicitly — keep doing so for consistency).
- All source lives under `src/`, output goes to `dist/`.

## Environment Variables

Stored at `~/.wui/.env` (created by first-run setup). Dev fallback: `./.env` in working directory.
See `.env.example`:

```
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
JUPITER_API_KEY=your_jupiter_api_key_here
```

Both are required. The app runs interactive setup on first launch if either is missing.
Never commit `.env` or any file containing secrets.

## Project Structure

```
src/
  index.tsx          # Entry point — CLI router, setup flow, TUI launch
  app/               # Ink app shell, screen routing
    app.tsx           # Root component, keyboard nav, screen switching
    setup.tsx         # Interactive first-run configuration
    screens/          # One file per screen
      portfolio-screen.tsx
      swap-screen.tsx
      send-screen.tsx
      activity-screen.tsx
      wallets-screen.tsx
  components/        # Reusable UI components (Header, Footer, Splash)
  cli/               # Non-interactive CLI command handlers
    index.ts          # Arg parsing, bootstrap, output helpers
    portfolio.ts      # wui portfolio
    activity.ts       # wui activity
    send.ts           # wui send
  wallet/            # Keypair loading, signing, wallet CRUD
  portfolio/         # Token accounts, balances
  pricing/           # Price fetching, token metadata, caching
  swap/              # Jupiter swap: quote, build, sign, send, confirm
  transfer/          # SOL + SPL + Token-2022 transfers
  activity/          # Transaction history, classification
  rpc/               # RPC client init + health check
  errors/            # Shared error utilities (fetchWithTimeout, formatTransactionError)
  clipboard/         # System clipboard integration
  format/            # Shared formatting utilities and constants
  types/             # Shared type definitions
  config/            # Env loading and validation
```

## Architecture Rules

**Dependency direction is strictly enforced:**

- `wallet/`, `swap/`, `portfolio/`, `pricing/`, `activity/`, `rpc/`, `transfer/`, `errors/`, `clipboard/`, `format/` are service modules.
- Service modules must NOT import from `app/`, `components/`, or `cli/`.
- Service modules may depend on each other, on `types/`, and on external libraries.
- Only `app/`, `components/`, and `cli/` import from service modules — never the reverse.

## Code Style

### Imports

- Use **ESM imports** with explicit `.js` extensions on all local imports (required by the ESM + bundler setup):
  ```ts
  import { loadConfig } from "./config/index.js";
  import type { WalletEntry } from "../types/wallet.js";
  ```
- Order: (1) Node built-ins, (2) external packages, (3) local modules, (4) type-only imports.
- Use `import type` for type-only imports:
  ```ts
  import type { Screen } from "../types/screens.js";
  ```

### Naming

- **Files**: lowercase kebab-case (`portfolio-screen.tsx`, `wallet.ts`).
- **Functions**: camelCase (`loadConfig`, `getActiveWalletEntry`).
- **Components**: PascalCase, `export default function ComponentName()`.
- **Interfaces/Types**: PascalCase (`AppConfig`, `WalletEntry`, `WalletStore`).
- **Constants**: UPPER_SNAKE_CASE for module-level constants (`SCREEN_KEYS`, `DATA_DIR`, `NATIVE_SOL_MINT`).
- **Component props**: `interface ComponentNameProps` defined directly above the component.

### Formatting

- **Indentation**: 2 spaces.
- **Quotes**: double quotes for strings.
- **Semicolons**: always.
- **Trailing commas**: yes, in multi-line constructs.
- **Line length**: no hard limit, but keep lines reasonable (~100 chars).

### Types

- Strict TypeScript — no `any`. Use proper types or `unknown` + narrowing.
- Define interfaces in `src/types/` for shared types. Colocate component-specific interfaces (like props) in the component file.
- Use non-null assertion (`!`) sparingly and only after a preceding guard.
- Prefer `interface` over `type` for object shapes.

### Components (Ink/React)

- Functional components only — no classes.
- Export components as `export default function Name()`.
- Props interface defined right above the component.
- Use Ink primitives: `<Box>`, `<Text>`, `useInput`, `useApp`.
- Keyboard handling via `useInput` hook.
- Layout via Ink's flexbox props: `flexDirection`, `paddingX`, `gap`, `justifyContent`, etc.

### Error Handling

- **Fail fast**: throw `new Error("descriptive message")` with user-actionable text.
- All outbound `fetch()` calls use `fetchWithTimeout()` from `src/errors/index.ts` (15s timeout, friendly network error messages).
- On-chain transaction errors are translated via `formatTransactionError()` to plain English.
- Top-level `main().catch()` in entry point handles uncaught errors, logs `err.message`, and exits with code 1.
- For non-fatal checks (like RPC health), return a boolean and let the caller decide.
- Use `try/catch` only where recovery is possible — don't silently swallow errors.

### Shared Utilities

- **Formatting functions** (`truncateAddress`, `formatUsd`, `formatBalance`, `formatPercent`, `formatAmount`, `formatTime`, `formatCompact`) live in `src/format/index.ts`. Import from there — never duplicate.
- **Shared constants** (`NATIVE_SOL_MINT`, `JUPITER_BASE_URL`) also live in `src/format/index.ts`.

### Module Pattern

- Each module directory has an `index.ts` barrel file that exports the public API.
- Keep internal helpers as unexported functions within the module file.
- Use JSDoc comments (`/** ... */`) for non-obvious public functions.

## Key Dependencies

| Package       | Purpose                                     |
| ------------- | ------------------------------------------- |
| `ink`         | React renderer for terminal UIs             |
| `ink-link`    | Terminal hyperlinks (OSC 8)                 |
| `react`       | Component model (v19)                       |
| `@solana/kit` | Solana RPC, keypairs, transactions (v2 SDK) |
| `dotenv`      | Environment variable loading                |
| `tsup`        | Production bundler (ESM output)             |
| `tsx`         | Dev-time TypeScript execution               |

## Data Storage

User data is stored at `~/.wui/` (migrated automatically from `~/.walletui/` if present):

- `.env` — configuration (RPC URL + Jupiter API key), mode `0o600`
- `wallets.json` — wallet registry (labels, public keys, paths — NO secrets), mode `0o600`
- `keys/` — generated keypair files (Solana CLI format: 64-byte JSON array), mode `0o600`

## Keyboard Shortcuts

### Global (app-level)
| Key | Action |
|-----|--------|
| `p` | Portfolio screen |
| `s` | Swap screen |
| `t` | Transfer screen |
| `a` | Activity screen |
| `w` | Wallets screen |
| `r` | Refresh (portfolio + activity screens) |
| `q` | Quit |

### Per-screen
| Screen | Key | Action |
|--------|-----|--------|
| Portfolio | `up/down` | Navigate tokens |
| Portfolio | `enter` | Toggle detail drawer |
| Portfolio | `y` | Copy mint address (detail open) |
| Swap | `enter` | Confirm step |
| Swap | `y` | Copy tx signature (result) |
| Send | `enter` | Confirm step |
| Send | `y` | Copy tx signature (result) |
| Activity | `up/down` | Navigate transactions |
| Activity | `enter` | Toggle detail drawer |
| Activity | `y` | Copy tx signature (detail open) |
| Wallets | `enter` | Switch wallet |
| Wallets | `y` | Copy public key |
| Wallets | `c` | Create wallet |
| Wallets | `i` | Import wallet |
| Wallets | `l` | Rename wallet |
| Wallets | `d` | Delete wallet |

## CLI Commands

```bash
wui                    # Launch interactive TUI (default)
wui config             # Re-run configuration setup
wui portfolio          # Print portfolio table
wui portfolio --json   # JSON output
wui activity           # Print recent transactions
wui activity --json    # JSON output
wui send <addr> <amt> <token>  # Send tokens
wui --help             # Usage info
```

## Security Constraints

- Private keys never leave the machine, are never logged, displayed, or sent over the network.
- Signing always happens locally.
- All sensitive files written with mode `0o600` (owner read/write only).
- `.env` is gitignored — never commit it.
- `wallets.json` stores only public keys and file paths, never key material.
- All outbound network calls go to only two destinations: the configured Solana RPC and Jupiter APIs (`api.jup.ag`).
