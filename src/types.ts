/**
 * Goals Plugin Types
 *
 * Plugin-specific types. SDK types are imported from @treeline-money/plugin-sdk
 */

/** How much of an account is allocated to a goal */
export interface AccountAllocation {
  account_id: string;
  /** "percentage" or "fixed" */
  allocation_type: "percentage" | "fixed";
  /** If percentage: 0-100, if fixed: dollar amount */
  allocation_value: number;
}

/** A savings goal */
export interface Goal {
  id: string;
  name: string;
  target_amount: number;
  /** Optional deadline */
  target_date: string | null;
  /** Account allocations for this goal */
  allocations: AccountAllocation[] | null;
  /** Starting balance when goal was created */
  starting_balance: number;
  /** Icon/emoji for the goal */
  icon: string;
  /** Color for progress bar */
  color: string;
  /** Whether goal is active */
  active: boolean;
  /** Whether goal is completed */
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Account info for goal linking */
export interface Account {
  account_id: string;
  name: string;
  balance: number;
  account_type: string | null;
}
