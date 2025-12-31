import type { Plugin, PluginContext, PluginSDK, PluginMigration } from "@treeline-money/plugin-sdk";
import GoalsView from "./GoalsView.svelte";
import { mount, unmount } from "svelte";

// Database migrations - run in order by version when plugin loads
const migrations: PluginMigration[] = [
  {
    version: 1,
    name: "create_goals_table",
    up: `
      CREATE TABLE IF NOT EXISTS plugin_goals.goals (
        id VARCHAR PRIMARY KEY,
        name VARCHAR NOT NULL,
        target_amount DECIMAL(15,2) NOT NULL,
        target_date DATE,
        allocations JSON,
        starting_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
        icon VARCHAR NOT NULL DEFAULT '🎯',
        color VARCHAR NOT NULL DEFAULT '#3b82f6',
        active BOOLEAN NOT NULL DEFAULT TRUE,
        completed BOOLEAN NOT NULL DEFAULT FALSE,
        completed_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `,
  },
];

export const plugin: Plugin = {
  manifest: {
    id: "goals",
    name: "Savings Goals",
    version: "0.1.0",
    description:
      "Track savings goals like emergency funds, house down payments, and more",
    author: "Treeline",
    permissions: {
      read: ["accounts", "sys_balance_snapshots"],
      schemaName: "plugin_goals",
    },
  },

  migrations,

  activate(context: PluginContext) {
    // Register the main view
    context.registerView({
      id: "goals",
      name: "Goals",
      icon: "target",
      mount: (target: HTMLElement, props: { sdk: PluginSDK }) => {
        const instance = mount(GoalsView, {
          target,
          props,
        });

        return () => {
          unmount(instance);
        };
      },
    });

    // Add to sidebar
    context.registerSidebarItem({
      sectionId: "main",
      id: "goals",
      label: "Goals",
      icon: "target",
      viewId: "goals",
    });

    // Register command for quick access
    context.registerCommand({
      id: "goals.open",
      name: "View Savings Goals",
      description: "Open the savings goals tracker",
      execute: () => {
        context.openView("goals");
      },
    });

    console.log("✓ Savings Goals plugin loaded");
  },

  deactivate() {
    console.log("Savings Goals plugin deactivated");
  },
};
