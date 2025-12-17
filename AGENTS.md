# Savings Goals Plugin

A Treeline plugin for tracking savings goals like emergency funds, house down payments, and more.

## Key Files

| File | Purpose |
|------|---------|
| `manifest.json` | Plugin metadata (id: "goals") |
| `src/index.ts` | Plugin entry point |
| `src/GoalsView.svelte` | Main UI component |
| `src/types.ts` | TypeScript types for the Plugin SDK |

## Quick Commands

```bash
npm install          # Install dependencies
npm run build        # Build to dist/index.js
npm run dev          # Watch mode
tl plugin install .  # Install locally for testing
```

## Plugin Data

This plugin stores goals in `sys_plugin_goals` table:

```sql
CREATE TABLE IF NOT EXISTS sys_plugin_goals (
  id VARCHAR PRIMARY KEY,
  name VARCHAR NOT NULL,
  target_amount DECIMAL NOT NULL,
  current_amount DECIMAL DEFAULT 0,
  target_date DATE,
  color VARCHAR,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
```

## SDK Quick Reference

Views receive `sdk` via props:

```svelte
<script lang="ts">
  import type { PluginSDK } from "./types";
  let { sdk }: { sdk: PluginSDK } = $props();
</script>
```

| Method | What it does |
|--------|--------------|
| `sdk.query(sql)` | Read data |
| `sdk.execute(sql)` | Write to sys_plugin_goals |
| `sdk.toast.success/error(msg)` | Show notifications |
| `sdk.theme.current()` | Get "light" or "dark" |
| `sdk.settings.get/set()` | Persist settings |

## Releasing

```bash
./scripts/release.sh 0.1.0   # Tags and pushes, GitHub Action creates release
```

## Full Documentation

See https://github.com/zack-schrag/treeline-money/blob/main/docs/plugins.md
