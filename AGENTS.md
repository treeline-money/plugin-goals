# Savings Goals Plugin

A Treeline plugin for tracking savings goals like emergency funds, house down payments, and more.

## Key Files

| File | Purpose |
|------|---------|
| `manifest.json` | Plugin metadata (id: "goals") |
| `src/index.ts` | Plugin entry point |
| `src/GoalsView.svelte` | Main UI component |
| `package.json` | Dependencies (includes `@treeline-money/plugin-sdk`) |

## Quick Commands

```bash
npm install          # Install dependencies
npm run build        # Build to dist/index.js
npm run dev          # Watch mode
tl plugin install .  # Install locally for testing
```

## Plugin Data

This plugin stores goals in `plugin_goals.goals` table:

```sql
CREATE TABLE IF NOT EXISTS plugin_goals.goals (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  target_amount DECIMAL(15,2) NOT NULL,
  target_date DATE,
  allocations JSON,                              -- account allocations [{account_id, type, value}]
  starting_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  icon VARCHAR NOT NULL DEFAULT '🎯',
  color VARCHAR NOT NULL DEFAULT '#3b82f6',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)
```

## SDK Import

All types are imported from the npm package:

```typescript
import type { Plugin, PluginContext, PluginSDK } from "@treeline-money/plugin-sdk";
```

Views receive `sdk` via props:

```svelte
<script lang="ts">
  import type { PluginSDK } from "@treeline-money/plugin-sdk";

  interface Props {
    sdk: PluginSDK;
  }
  let { sdk }: Props = $props();
</script>
```

## SDK Quick Reference

| Method | What it does |
|--------|--------------|
| `sdk.query(sql)` | Read data |
| `sdk.execute(sql)` | Write to plugin_goals.goals |
| `sdk.toast.success/error/info(msg)` | Show notifications |
| `sdk.openView(viewId, props?)` | Navigate to another view |
| `sdk.onDataRefresh(callback)` | React when data changes |
| `sdk.emitDataRefresh()` | Notify other views data changed |
| `sdk.theme.current()` | Get "light" or "dark" |
| `sdk.settings.get/set()` | Persist settings |
| `sdk.currency.format(amount)` | Format as currency |

## Releasing

```bash
./scripts/release.sh 0.1.0   # Tags and pushes, GitHub Action creates release
```

## Full Documentation

See https://github.com/treeline-money/treeline
