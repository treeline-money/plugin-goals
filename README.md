# Savings Goals

A [Treeline](https://github.com/treeline-money/treeline) plugin for tracking savings goals with account allocations.

## Features

- **Multiple goals**: Track any number of financial goals simultaneously
- **Account allocations**: Link goals to accounts with percentage or fixed dollar allocations
- **Progress tracking**: Visual progress bars and "on track" status for goals with deadlines
- **Preset templates**: Quick-start common goals (emergency fund, house, vacation, car, wedding, education)
- **Custom styling**: Set icons and colors for each goal
- **Target dates**: Optional deadlines with "monthly needed" calculations
- **Completion tracking**: Mark goals complete and view archived goals

## How It Works

1. **Create a goal**: Set name, target amount, and optional target date
2. **Link accounts**: Allocate percentages or fixed amounts from your accounts
3. **Track progress**: Balance is calculated automatically from linked accounts
4. **Complete**: Mark as complete when reached, or reopen if needed

Goals without linked accounts are tracked manually using the starting balance.

## Installation

### From Community Plugins (Recommended)

1. Open Treeline
2. Go to Settings > Plugins > Community Plugins
3. Find "Savings Goals" and click Install
4. Restart Treeline

### Manual Installation

```bash
tl plugin install https://github.com/treeline-money/plugin-goals
# Restart Treeline
```

## Development

```bash
git clone https://github.com/treeline-money/plugin-goals
cd plugin-goals
npm install
npm run build
tl plugin install .
```

## License

MIT
