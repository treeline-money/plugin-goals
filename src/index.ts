import type { Plugin, PluginContext, PluginSDK } from "@treeline-money/plugin-sdk";
import GoalsView from "./GoalsView.svelte";
import { mount, unmount } from "svelte";

export const plugin: Plugin = {
  manifest: {
    id: "goals",
    name: "Savings Goals",
    version: "0.1.0",
    description:
      "Track savings goals like emergency funds, house down payments, and more",
    author: "Treeline",
    permissions: {
      tables: {
        read: ["accounts", "sys_balance_snapshots", "sys_plugin_goals"],
        create: ["sys_plugin_goals"],
      },
    },
  },

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
