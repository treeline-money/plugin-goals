<script lang="ts">
  import type { PluginSDK } from "@treeline-money/plugin-sdk";
  import type { Goal, Account, AccountAllocation } from "./types";

  // Props from plugin SDK
  const { sdk }: { sdk: PluginSDK } = $props();

  // Common emoji for goal icons
  const goalEmoji = [
    "🎯", "🏠", "🚗", "✈️", "🏖️", "💒", "🎓", "💼",
    "🛡️", "💰", "🏦", "📱", "💻", "🎸", "🏋️", "🐶",
    "👶", "🎄", "🎁", "⚽", "🚴", "🏕️", "🔧", "📚",
  ];

  // ============================================================================
  // State
  // ============================================================================

  let loading = $state(true);
  let error = $state<string | null>(null);

  // Data
  let goals = $state<Goal[]>([]);
  let accounts = $state<Account[]>([]);
  let goalBalances = $state<Map<string, number>>(new Map());
  let goalHistory = $state<Map<string, { date: string; balance: number }[]>>(new Map());

  // UI state
  let showAddGoal = $state(false);
  let editingGoal = $state<Goal | null>(null);
  let selectedGoal = $state<Goal | null>(null);
  let showCompleted = $state(false);
  let showCelebration = $state(false);

  // Form state for new goal
  interface FormAllocation {
    account_id: string;
    allocation_type: "percentage" | "fixed";
    allocation_value: number;
  }

  let newGoalName = $state("");
  let newGoalTargetAmount = $state(0);
  let newGoalTargetDate = $state<string | null>(null);
  let newGoalStartAmount = $state<number | null>(null);
  let newGoalIcon = $state("🎯");
  let newGoalColor = $state("#3b82f6");
  let newGoalImageUrl = $state<string | null>(null);
  let newGoalAllocations = $state<FormAllocation[]>([]);


  // ============================================================================
  // Initialization
  // ============================================================================

  async function initialize() {
    loading = true;
    error = null;
    try {
      // Tables are created by migrations in index.ts - just load data
      await Promise.all([loadAccounts(), loadGoals()]);
      await calculateBalances();
      await loadGoalHistory();
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to initialize";
      console.error("Goals init error:", e);
    } finally {
      loading = false;
    }
  }

  async function loadAccounts() {
    // Get accounts with latest balance from snapshots
    // Uses a subquery to get the most recent snapshot per account
    const result = await sdk.query<unknown[]>(`
      SELECT
        a.account_id,
        COALESCE(a.nickname, a.name) as name,
        COALESCE(latest.balance, a.balance, 0) as balance,
        a.account_type
      FROM accounts a
      LEFT JOIN (
        SELECT account_id, balance
        FROM sys_balance_snapshots s1
        WHERE snapshot_time = (
          SELECT MAX(snapshot_time)
          FROM sys_balance_snapshots s2
          WHERE s2.account_id = s1.account_id
        )
      ) latest ON a.account_id = latest.account_id
      ORDER BY name
    `);

    accounts = result.map((row) => ({
      account_id: row[0] as string,
      name: row[1] as string,
      balance: Number(row[2]) || 0,
      account_type: row[3] as string | null,
    }));
  }

  async function loadGoals() {
    const result = await sdk.query<unknown[]>(`
      SELECT id, name, target_amount, target_date, allocations, starting_balance,
             icon, color, image_url, active, completed, completed_at, created_at, updated_at
      FROM plugin_goals.goals
      ORDER BY completed ASC, created_at DESC
    `);

    goals = result.map((row) => ({
      id: row[0] as string,
      name: row[1] as string,
      target_amount: Number(row[2]) || 0,
      target_date: row[3] as string | null,
      allocations: row[4] ? JSON.parse(row[4] as string) : null,
      starting_balance: Number(row[5]) || 0,
      icon: row[6] as string,
      color: row[7] as string,
      image_url: row[8] as string | null,
      active: Boolean(row[9]),
      completed: Boolean(row[10]),
      completed_at: row[11] as string | null,
      created_at: row[12] as string,
      updated_at: row[13] as string,
    }));
  }

  async function loadGoalHistory() {
    // Derive goal history from account snapshots
    // Only works for goals with account allocations
    const historyMap = new Map<string, { date: string; balance: number }[]>();

    for (const goal of goals) {
      if (!goal.allocations || goal.allocations.length === 0) {
        // Manual goals have no history
        continue;
      }

      // Get account IDs for this goal
      const accountIds = goal.allocations.map(a => a.account_id);
      const placeholders = accountIds.map(() => '?').join(',');

      // Query historical balances for these accounts
      const result = await sdk.query<unknown[]>(`
        SELECT
          CAST(snapshot_time AS DATE) as snapshot_date,
          account_id,
          balance
        FROM sys_balance_snapshots
        WHERE account_id IN (${placeholders})
        ORDER BY snapshot_date
      `, accountIds);

      // Group by date
      const byDate = new Map<string, Map<string, number>>();

      for (const row of result) {
        const date = String(row[0]).split('T')[0];
        const accountId = row[1] as string;
        const balance = Number(row[2]) || 0;

        if (!byDate.has(date)) byDate.set(date, new Map());
        byDate.get(date)!.set(accountId, balance);
      }

      // Calculate goal balance for each date using allocation rules
      // Carry forward last known balance for accounts without snapshots on a given day
      const history: { date: string; balance: number }[] = [];
      const runningBalances = new Map<string, number>();

      // Sort dates and process in order to carry forward balances
      const sortedDates = [...byDate.keys()].sort();
      for (const date of sortedDates) {
        const accountBalances = byDate.get(date)!;

        // Update running balances with any new snapshots for this date
        for (const [accountId, balance] of accountBalances) {
          runningBalances.set(accountId, balance);
        }

        // Calculate goal balance using running balances (carries forward missing accounts)
        let goalBalance = 0;
        for (const alloc of goal.allocations) {
          const accountBalance = runningBalances.get(alloc.account_id) || 0;
          if (alloc.allocation_type === 'percentage') {
            goalBalance += (accountBalance * alloc.allocation_value) / 100;
          } else {
            goalBalance += Math.min(alloc.allocation_value, accountBalance);
          }
        }
        history.push({ date, balance: goalBalance });
      }

      // Sort by date and store
      history.sort((a, b) => a.date.localeCompare(b.date));
      historyMap.set(goal.id, history);
    }

    goalHistory = historyMap;
  }

  async function calculateBalances() {
    const balances = new Map<string, number>();

    for (const goal of goals) {
      if (goal.allocations && goal.allocations.length > 0) {
        // Sum allocated amounts from linked accounts
        let total = 0;
        for (const alloc of goal.allocations) {
          const account = accounts.find((a) => a.account_id === alloc.account_id);
          if (account) {
            if (alloc.allocation_type === "percentage") {
              // Percentage of account balance
              total += (account.balance * alloc.allocation_value) / 100;
            } else {
              // Fixed amount (capped at account balance)
              total += Math.min(alloc.allocation_value, account.balance);
            }
          }
        }
        balances.set(goal.id, total);
      } else {
        // No linked accounts - use starting balance (manual tracking)
        balances.set(goal.id, goal.starting_balance);
      }
    }

    goalBalances = balances;
  }

  // ============================================================================
  // Goal CRUD
  // ============================================================================

  async function createGoal() {
    if (!newGoalName || !newGoalTargetAmount) {
      sdk.toast.error("Name and target amount are required");
      return;
    }

    const id = crypto.randomUUID();
    const allocationsJson = newGoalAllocations.length > 0
      ? JSON.stringify(newGoalAllocations)
      : null;

    // Use user-specified start amount, or default to 0 if not set
    const startingBalance = newGoalStartAmount ?? 0;

    await sdk.execute(`
      INSERT INTO plugin_goals.goals
        (id, name, target_amount, target_date, allocations, starting_balance, icon, color, image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id,
      newGoalName,
      newGoalTargetAmount,
      newGoalTargetDate,
      allocationsJson ? JSON.stringify(newGoalAllocations) : null,
      startingBalance,
      newGoalIcon || "🎯",
      newGoalColor || "#3b82f6",
      newGoalImageUrl || null
    ]);

    sdk.toast.success(`Goal "${newGoalName}" created!`);
    showAddGoal = false;
    resetForm();
    await loadGoals();
    await calculateBalances();
  }

  async function updateGoal(goal: Goal) {
    const allocationsJson = goal.allocations
      ? JSON.stringify(goal.allocations)
      : null;

    await sdk.execute(`
      UPDATE plugin_goals.goals SET
        name = ?,
        target_amount = ?,
        target_date = ?,
        allocations = ?,
        starting_balance = ?,
        icon = ?,
        color = ?,
        image_url = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [
      goal.name,
      goal.target_amount,
      goal.target_date || null,
      allocationsJson,
      goal.starting_balance,
      goal.icon,
      goal.color,
      goal.image_url || null,
      goal.id
    ]);

    sdk.toast.success("Goal updated");
    editingGoal = null;
    await loadGoals();
    await calculateBalances();
  }

  async function deleteGoal(id: string) {
    await sdk.execute(`DELETE FROM plugin_goals.goals WHERE id = ?`, [id]);
    sdk.toast.success("Goal deleted");
    await loadGoals();
  }

  async function markComplete(goal: Goal) {
    await sdk.execute(`
      UPDATE plugin_goals.goals SET
        completed = TRUE,
        completed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [goal.id]);

    // Trigger confetti celebration
    showCelebration = true;
    setTimeout(() => {
      showCelebration = false;
    }, 3500);

    sdk.toast.success(`Goal "${goal.name}" completed!`);
    await loadGoals();
  }

  async function reopenGoal(goal: Goal) {
    await sdk.execute(`
      UPDATE plugin_goals.goals SET
        completed = FALSE,
        completed_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [goal.id]);
    await loadGoals();
  }

  function resetForm() {
    newGoalName = "";
    newGoalTargetAmount = 0;
    newGoalTargetDate = null;
    newGoalStartAmount = null;
    newGoalIcon = "🎯";
    newGoalColor = "#3b82f6";
    newGoalImageUrl = null;
    newGoalAllocations = [];
  }


  function addAllocation() {
    if (accounts.length === 0) return;
    // Find first account not already allocated
    const usedIds = new Set(newGoalAllocations.map(a => a.account_id));
    const available = accounts.find(a => !usedIds.has(a.account_id));
    if (!available) {
      sdk.toast.warning("All accounts already allocated");
      return;
    }
    newGoalAllocations = [...newGoalAllocations, {
      account_id: available.account_id,
      allocation_type: "percentage" as const,
      allocation_value: 100,
    }];
  }

  function removeAllocation(index: number) {
    newGoalAllocations = newGoalAllocations.filter((_, i) => i !== index);
  }

  function addEditAllocation(goal: Goal) {
    if (!goal.allocations) goal.allocations = [];
    const usedIds = new Set(goal.allocations.map(a => a.account_id));
    const available = accounts.find(a => !usedIds.has(a.account_id));
    if (!available) {
      sdk.toast.warning("All accounts already allocated");
      return;
    }
    goal.allocations = [...goal.allocations, {
      account_id: available.account_id,
      allocation_type: "percentage" as const,
      allocation_value: 100,
    }];
  }

  function removeEditAllocation(goal: Goal, index: number) {
    if (!goal.allocations) return;
    goal.allocations = goal.allocations.filter((_, i) => i !== index);
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  function formatCurrency(amount: number): string {
    return sdk.currency.format(amount);
  }

  function formatDate(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function getProgress(goal: Goal): number {
    const current = goalBalances.get(goal.id) || 0;
    const saved = current - goal.starting_balance;
    const needed = goal.target_amount - goal.starting_balance;
    if (needed <= 0) return 100;
    return Math.min(100, Math.max(0, (saved / needed) * 100));
  }

  function getCurrentAmount(goal: Goal): number {
    return goalBalances.get(goal.id) || goal.starting_balance;
  }

  function getRemainingAmount(goal: Goal): number {
    const current = getCurrentAmount(goal);
    return Math.max(0, goal.target_amount - current);
  }

  function getDaysRemaining(goal: Goal): number | null {
    if (!goal.target_date) return null;
    const target = new Date(goal.target_date);
    const today = new Date();
    const diff = target.getTime() - today.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  function getMonthlyNeeded(goal: Goal): number | null {
    const days = getDaysRemaining(goal);
    if (days === null || days <= 0) return null;
    const remaining = getRemainingAmount(goal);
    const months = days / 30;
    return remaining / months;
  }

  function isOnTrack(goal: Goal): boolean | null {
    if (!goal.target_date) return null;
    const days = getDaysRemaining(goal);
    if (days === null) return null;

    const totalDays =
      (new Date(goal.target_date).getTime() -
        new Date(goal.created_at).getTime()) /
      (1000 * 60 * 60 * 24);
    const elapsed = totalDays - days;
    const expectedProgress = (elapsed / totalDays) * 100;
    const actualProgress = getProgress(goal);

    return actualProgress >= expectedProgress - 5; // 5% tolerance
  }

  function getChartData(goal: Goal): { path: string; points: { x: number; y: number; date: string; balance: number }[]; minY: number; maxY: number } {
    const history = goalHistory.get(goal.id) || [];
    const current = getCurrentAmount(goal);

    // Build data points: history + current
    let dataPoints: { date: string; balance: number }[] = [...history];

    // Add current balance as today if not already in history
    const today = new Date().toISOString().split("T")[0];
    if (dataPoints.length === 0 || dataPoints[dataPoints.length - 1].date !== today) {
      dataPoints.push({ date: today, balance: current });
    }

    // Also add creation point if we have no history
    if (dataPoints.length === 1) {
      dataPoints.unshift({
        date: goal.created_at.split("T")[0],
        balance: goal.starting_balance,
      });
    }

    if (dataPoints.length < 2) {
      return { path: "", points: [], minY: 0, maxY: goal.target_amount };
    }

    // Downsample if too many points - aim for ~15-20 visible points max
    const maxPoints = 18;
    if (dataPoints.length > maxPoints) {
      const sampled: { date: string; balance: number }[] = [];
      // Always include first point
      sampled.push(dataPoints[0]);

      // Sample evenly from the middle
      const step = (dataPoints.length - 2) / (maxPoints - 2);
      for (let i = 1; i < maxPoints - 1; i++) {
        const idx = Math.round(1 + (i - 1) * step);
        sampled.push(dataPoints[idx]);
      }

      // Always include last point
      sampled.push(dataPoints[dataPoints.length - 1]);
      dataPoints = sampled;
    }

    // Chart dimensions
    const width = 400;
    const height = 150;
    const padding = { top: 10, right: 10, bottom: 20, left: 50 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    // Calculate scales
    const dates = dataPoints.map((d) => new Date(d.date).getTime());
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    const dateRange = maxDate - minDate || 1;

    const balances = dataPoints.map((d) => d.balance);
    const minBalance = Math.min(0, ...balances);
    const maxBalance = Math.max(goal.target_amount, ...balances);
    const balanceRange = maxBalance - minBalance || 1;

    // Generate points
    const points = dataPoints.map((d) => {
      const x = padding.left + ((new Date(d.date).getTime() - minDate) / dateRange) * chartWidth;
      const y = padding.top + chartHeight - ((d.balance - minBalance) / balanceRange) * chartHeight;
      return { x, y, date: d.date, balance: d.balance };
    });

    // Generate SVG path
    const path = points
      .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(" ");

    return { path, points, minY: minBalance, maxY: maxBalance };
  }

  function getTargetLineY(goal: Goal, minY: number, maxY: number): number {
    const height = 150;
    const padding = { top: 10, bottom: 20 };
    const chartHeight = height - padding.top - padding.bottom;
    const range = maxY - minY || 1;
    return padding.top + chartHeight - ((goal.target_amount - minY) / range) * chartHeight;
  }

  function getPaceProjection(goal: Goal): string | null {
    const history = goalHistory.get(goal.id) || [];
    const current = getCurrentAmount(goal);

    if (current >= goal.target_amount) return null;

    // If we have history, use it for projection
    if (history.length >= 2) {
      const first = history[0];
      const last = history[history.length - 1];
      const daysBetween =
        (new Date(last.date).getTime() - new Date(first.date).getTime()) /
        (1000 * 60 * 60 * 24);

      if (daysBetween >= 1) {
        const balanceChange = last.balance - first.balance;
        const dailyRate = balanceChange / daysBetween;

        if (dailyRate > 0) {
          const remaining = goal.target_amount - current;
          const daysToGoal = remaining / dailyRate;
          const projectedDate = new Date();
          projectedDate.setDate(projectedDate.getDate() + daysToGoal);

          return projectedDate.toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
          });
        }
      }
    }

    // Fallback: calculate from goal creation to now
    const daysSinceCreation =
      (Date.now() - new Date(goal.created_at).getTime()) / (1000 * 60 * 60 * 24);

    if (daysSinceCreation < 1) return null;

    const progressMade = current - goal.starting_balance;
    if (progressMade <= 0) return null;

    const dailyRate = progressMade / daysSinceCreation;
    const remaining = goal.target_amount - current;
    const daysToGoal = remaining / dailyRate;
    const projectedDate = new Date();
    projectedDate.setDate(projectedDate.getDate() + daysToGoal);

    return projectedDate.toLocaleDateString("en-US", {
      month: "short",
      year: "numeric",
    });
  }

  // ============================================================================
  // Derived State
  // ============================================================================

  let activeGoals = $derived(goals.filter((g) => !g.completed));
  let completedGoals = $derived(goals.filter((g) => g.completed));

  // ============================================================================
  // Lifecycle
  // ============================================================================

  $effect(() => {
    initialize();
  });

  $effect(() => {
    const unsubscribe = sdk.onDataRefresh(() => {
      initialize();
    });
    return unsubscribe;
  });
</script>

<div class="view">
  <!-- Confetti celebration -->
  {#if showCelebration}
    <div class="confetti-container">
      {#each Array(50) as _, i}
        <div class="confetti" style="--delay: {Math.random() * 3}s; --x: {Math.random() * 100}vw; --rotation: {Math.random() * 360}deg; --color: {['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'][i % 6]}"></div>
      {/each}
    </div>
  {/if}

  <header class="header">
    <h1>Savings Goals</h1>
    <button class="btn primary" onclick={() => (showAddGoal = true)}>
      + New Goal
    </button>
  </header>

  {#if loading}
    <div class="loading">
      <div class="spinner"></div>
      <p>Loading goals...</p>
    </div>
  {:else if error}
    <div class="error">
      <p>{error}</p>
      <button class="btn primary" onclick={() => initialize()}>Retry</button>
    </div>
  {:else}
    <!-- Goals Grid -->
    <div class="content">
      {#if activeGoals.length === 0 && completedGoals.length === 0}
        <div class="empty">
          <p>No savings goals yet.</p>
          <p>Create a goal to start tracking your progress!</p>
          <button class="btn primary" onclick={() => (showAddGoal = true)}>
            Create Your First Goal
          </button>
        </div>
      {:else}
        <div class="goals-grid">
          {#each activeGoals as goal}
            {@const progress = getProgress(goal)}
            {@const current = getCurrentAmount(goal)}
            {@const remaining = getRemainingAmount(goal)}
            {@const daysLeft = getDaysRemaining(goal)}
            {@const monthlyNeeded = getMonthlyNeeded(goal)}
            {@const onTrack = isOnTrack(goal)}
            {@const paceProjection = getPaceProjection(goal)}
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <div class="goal-card" onclick={() => (selectedGoal = goal)}>
              {#if goal.image_url}
                <div class="goal-image">
                  <img
                    src={goal.image_url.startsWith("/") ? `file://${goal.image_url}` : goal.image_url}
                    alt={goal.name}
                  />
                </div>
              {/if}

              <div class="goal-header">
                <span class="goal-icon">{goal.icon}</span>
                <div class="goal-title">
                  <h3>{goal.name}</h3>
                  {#if goal.target_date}
                    <span class="goal-date">
                      {#if daysLeft !== null && daysLeft > 0}
                        {daysLeft} days left
                      {:else if daysLeft !== null && daysLeft <= 0}
                        Past due
                      {/if}
                    </span>
                  {/if}
                </div>
                <div class="goal-actions">
                  <button
                    class="btn-icon"
                    onclick={(e) => { e.stopPropagation(); editingGoal = { ...goal }; }}
                    title="Edit"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                    </svg>
                  </button>
                  <button
                    class="btn-icon"
                    onclick={(e) => { e.stopPropagation(); deleteGoal(goal.id); }}
                    title="Delete"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 6h18 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>
              </div>

              <div class="goal-progress">
                <div class="progress-bar">
                  <div
                    class="progress-fill"
                    style="width: {progress}%; background: {goal.color}"
                  ></div>
                  <!-- Milestone markers -->
                  <div class="milestone-markers">
                    <span class="milestone" style="left: 25%"></span>
                    <span class="milestone" style="left: 50%"></span>
                    <span class="milestone" style="left: 75%"></span>
                  </div>
                </div>
                <div class="progress-labels">
                  <span>{formatCurrency(current)}</span>
                  <span class="progress-percent">{progress.toFixed(0)}%</span>
                  <span>{formatCurrency(goal.target_amount)}</span>
                </div>
              </div>

              <div class="goal-stats">
                <div class="stat">
                  <span class="stat-label">Remaining</span>
                  <span class="stat-value">{formatCurrency(remaining)}</span>
                </div>
                {#if monthlyNeeded !== null}
                  <div class="stat">
                    <span class="stat-label">Monthly needed</span>
                    <span class="stat-value">{formatCurrency(monthlyNeeded)}</span>
                  </div>
                {/if}
                {#if goal.target_date && paceProjection}
                  <div class="stat">
                    <span class="stat-label">At current pace</span>
                    <span class="stat-value">{paceProjection}</span>
                  </div>
                {:else if onTrack !== null}
                  <div class="stat">
                    <span class="stat-label">Status</span>
                    <span class="stat-value" class:on-track={onTrack} class:behind={!onTrack}>
                      {onTrack ? "On track" : "Behind"}
                    </span>
                  </div>
                {/if}
              </div>

              {#if goal.allocations && goal.allocations.length > 0}
                <div class="goal-accounts">
                  <span class="accounts-label">Tracking:</span>
                  {#each goal.allocations as alloc}
                    {@const account = accounts.find((a) => a.account_id === alloc.account_id)}
                    {#if account}
                      <span class="account-tag">
                        {account.name}
                        {#if alloc.allocation_type === "percentage"}
                          ({alloc.allocation_value}%)
                        {:else}
                          ({formatCurrency(alloc.allocation_value)})
                        {/if}
                      </span>
                    {/if}
                  {/each}
                </div>
              {/if}

              {#if progress >= 100}
                <button class="btn success full-width" onclick={() => markComplete(goal)}>
                  Mark Complete
                </button>
              {/if}
            </div>
          {/each}
        </div>

        <!-- Completed Goals -->
        {#if completedGoals.length > 0}
          <div class="completed-section">
            <button
              class="completed-toggle"
              onclick={() => (showCompleted = !showCompleted)}
            >
              {showCompleted ? "▼" : "▶"} Completed Goals ({completedGoals.length})
            </button>

            {#if showCompleted}
              <div class="completed-list">
                {#each completedGoals as goal}
                  <div class="completed-item">
                    <span class="goal-icon">{goal.icon}</span>
                    <span class="completed-name">{goal.name}</span>
                    <span class="completed-amount">{formatCurrency(goal.target_amount)}</span>
                    <span class="completed-date">
                      {goal.completed_at ? formatDate(goal.completed_at) : ""}
                    </span>
                    <button
                      class="btn text small"
                      onclick={() => reopenGoal(goal)}
                    >
                      Reopen
                    </button>
                    <button
                      class="btn text small danger"
                      onclick={() => deleteGoal(goal.id)}
                    >
                      Delete
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  {/if}

  <!-- Add Goal Modal -->
  {#if showAddGoal}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="modal-backdrop" onclick={() => (showAddGoal = false)}>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="modal" onclick={(e) => e.stopPropagation()}>
        <h3>Create New Goal</h3>

        <div class="form">
          <div class="form-group">
            <span class="form-label">Icon</span>
            <div class="emoji-picker">
              {#each goalEmoji as emoji}
                <button
                  type="button"
                  class="emoji-btn"
                  class:selected={newGoalIcon === emoji}
                  onclick={() => (newGoalIcon = emoji)}
                >
                  {emoji}
                </button>
              {/each}
              <input
                type="text"
                class="emoji-custom"
                bind:value={newGoalIcon}
                maxlength="2"
                placeholder="..."
              />
            </div>
          </div>

          <label class="form-label color-label">
            Color
            <input type="color" bind:value={newGoalColor} class="color-input" />
          </label>

          <label class="form-label">
            Goal Name
            <input
              type="text"
              bind:value={newGoalName}
              placeholder="e.g., Emergency Fund"
            />
          </label>

          <label class="form-label">
            Target Amount
            <input
              type="number"
              bind:value={newGoalTargetAmount}
              step="100"
              min="0"
              placeholder="10000"
            />
          </label>

          <label class="form-label">
            Starting Amount (optional)
            <input
              type="number"
              bind:value={newGoalStartAmount}
              step="100"
              min="0"
              placeholder="0"
            />
            <span class="form-hint">Progress is calculated from this starting point. Leave at 0 to count all current savings as progress.</span>
          </label>

          <label class="form-label">
            Target Date (optional)
            <input type="date" bind:value={newGoalTargetDate} />
          </label>

          <label class="form-label">
            Image (optional)
            <input
              type="text"
              bind:value={newGoalImageUrl}
              placeholder="https://... or /Users/.../image.jpg"
            />
            <span class="form-hint">URL or local file path</span>
          </label>

          <div class="allocations-section">
            <div class="allocations-header">
              <span class="form-label">Account Allocations</span>
              <button type="button" class="btn text small" onclick={addAllocation}>
                + Add Account
              </button>
            </div>
            {#if newGoalAllocations.length === 0}
              <p class="form-hint">No accounts linked. Goal will be tracked manually.</p>
            {:else}
              {#each newGoalAllocations as alloc, i}
                <div class="allocation-row">
                  <select bind:value={alloc.account_id} class="allocation-account">
                    {#each accounts as account}
                      <option value={account.account_id}>
                        {account.name} ({formatCurrency(account.balance)})
                      </option>
                    {/each}
                  </select>
                  <select bind:value={alloc.allocation_type} class="allocation-type">
                    <option value="percentage">%</option>
                    <option value="fixed">$</option>
                  </select>
                  <input
                    type="number"
                    bind:value={alloc.allocation_value}
                    class="allocation-value"
                    min="0"
                    max={alloc.allocation_type === "percentage" ? 100 : undefined}
                    step={alloc.allocation_type === "percentage" ? 1 : 100}
                  />
                  <button
                    type="button"
                    class="btn-icon danger"
                    onclick={() => removeAllocation(i)}
                  >
                    ✕
                  </button>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <div class="modal-actions">
          <button
            class="btn secondary"
            onclick={() => {
              showAddGoal = false;
              resetForm();
            }}
          >
            Cancel
          </button>
          <button class="btn primary" onclick={createGoal}>Create Goal</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Edit Goal Modal -->
  {#if editingGoal}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="modal-backdrop" onclick={() => (editingGoal = null)}>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="modal" onclick={(e) => e.stopPropagation()}>
        <h3>Edit Goal</h3>

        <div class="form">
          <div class="form-group">
            <span class="form-label">Icon</span>
            <div class="emoji-picker">
              {#each goalEmoji as emoji}
                <button
                  type="button"
                  class="emoji-btn"
                  class:selected={editingGoal.icon === emoji}
                  onclick={() => (editingGoal.icon = emoji)}
                >
                  {emoji}
                </button>
              {/each}
              <input
                type="text"
                class="emoji-custom"
                bind:value={editingGoal.icon}
                maxlength="2"
                placeholder="..."
              />
            </div>
          </div>

          <label class="form-label color-label">
            Color
            <input type="color" bind:value={editingGoal.color} class="color-input" />
          </label>

          <label class="form-label">
            Goal Name
            <input type="text" bind:value={editingGoal.name} />
          </label>

          <label class="form-label">
            Target Amount
            <input
              type="number"
              bind:value={editingGoal.target_amount}
              step="100"
              min="0"
            />
          </label>

          <label class="form-label">
            Starting Amount
            <input
              type="number"
              bind:value={editingGoal.starting_balance}
              step="100"
              min="0"
            />
            <span class="form-hint">Progress is calculated from this starting point. Set to 0 to count all current savings as progress.</span>
          </label>

          <label class="form-label">
            Target Date (optional)
            <input type="date" bind:value={editingGoal.target_date} />
          </label>

          <label class="form-label">
            Image (optional)
            <input
              type="text"
              bind:value={editingGoal.image_url}
              placeholder="https://... or /Users/.../image.jpg"
            />
            <span class="form-hint">URL or local file path</span>
          </label>

          <div class="allocations-section">
            <div class="allocations-header">
              <span class="form-label">Account Allocations</span>
              <button type="button" class="btn text small" onclick={() => addEditAllocation(editingGoal!)}>
                + Add Account
              </button>
            </div>
            {#if !editingGoal.allocations || editingGoal.allocations.length === 0}
              <p class="form-hint">No accounts linked. Goal is tracked manually.</p>
            {:else}
              {#each editingGoal.allocations as alloc, i}
                <div class="allocation-row">
                  <select bind:value={alloc.account_id} class="allocation-account">
                    {#each accounts as account}
                      <option value={account.account_id}>
                        {account.name} ({formatCurrency(account.balance)})
                      </option>
                    {/each}
                  </select>
                  <select bind:value={alloc.allocation_type} class="allocation-type">
                    <option value="percentage">%</option>
                    <option value="fixed">$</option>
                  </select>
                  <input
                    type="number"
                    bind:value={alloc.allocation_value}
                    class="allocation-value"
                    min="0"
                    max={alloc.allocation_type === "percentage" ? 100 : undefined}
                    step={alloc.allocation_type === "percentage" ? 1 : 100}
                  />
                  <button
                    type="button"
                    class="btn-icon danger"
                    onclick={() => removeEditAllocation(editingGoal!, i)}
                  >
                    ✕
                  </button>
                </div>
              {/each}
            {/if}
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn secondary" onclick={() => (editingGoal = null)}>
            Cancel
          </button>
          <button class="btn primary" onclick={() => updateGoal(editingGoal!)}>
            Save Changes
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Goal Detail Modal with Chart -->
  {#if selectedGoal}
    {@const progress = getProgress(selectedGoal)}
    {@const current = getCurrentAmount(selectedGoal)}
    {@const remaining = getRemainingAmount(selectedGoal)}
    {@const daysLeft = getDaysRemaining(selectedGoal)}
    {@const paceProjection = getPaceProjection(selectedGoal)}
    {@const chartData = getChartData(selectedGoal)}
    {@const hasHistory = chartData.points.length >= 2}
    {@const targetY = getTargetLineY(selectedGoal, chartData.minY, chartData.maxY)}
    <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
    <div class="modal-backdrop" onclick={() => (selectedGoal = null)}>
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
      <div class="modal detail-modal" onclick={(e) => e.stopPropagation()}>
        <!-- Header -->
        <div class="detail-header">
          <div class="detail-title">
            <span class="goal-icon large">{selectedGoal.icon}</span>
            <div>
              <h3>{selectedGoal.name}</h3>
              {#if selectedGoal.target_date}
                <span class="goal-date">
                  Target: {formatDate(selectedGoal.target_date)}
                  {#if daysLeft !== null && daysLeft > 0}
                    ({daysLeft} days left)
                  {:else if daysLeft !== null && daysLeft <= 0}
                    (Past due)
                  {/if}
                </span>
              {/if}
            </div>
          </div>
          <button class="btn-icon close" onclick={() => (selectedGoal = null)} title="Close">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <!-- Image if present -->
        {#if selectedGoal.image_url}
          <div class="detail-image">
            <img
              src={selectedGoal.image_url.startsWith("/") ? `file://${selectedGoal.image_url}` : selectedGoal.image_url}
              alt={selectedGoal.name}
            />
          </div>
        {/if}

        <!-- Progress Section -->
        <div class="detail-progress">
          <div class="progress-bar large">
            <div
              class="progress-fill"
              style="width: {progress}%; background: {selectedGoal.color}"
            ></div>
            <div class="milestone-markers">
              <span class="milestone" style="left: 25%"></span>
              <span class="milestone" style="left: 50%"></span>
              <span class="milestone" style="left: 75%"></span>
            </div>
          </div>
          <div class="progress-amounts">
            <div class="amount-current">
              <span class="amount-value">{formatCurrency(current)}</span>
              <span class="amount-label">saved</span>
            </div>
            <div class="amount-percent">{progress.toFixed(0)}%</div>
            <div class="amount-target">
              <span class="amount-value">{formatCurrency(selectedGoal.target_amount)}</span>
              <span class="amount-label">goal</span>
            </div>
          </div>
          <div class="detail-stats">
            <div class="stat">
              <span class="stat-label">Remaining</span>
              <span class="stat-value">{formatCurrency(remaining)}</span>
            </div>
            {#if paceProjection}
              <div class="stat">
                <span class="stat-label">At current pace</span>
                <span class="stat-value">{paceProjection}</span>
              </div>
            {/if}
            <div class="stat">
              <span class="stat-label">Started</span>
              <span class="stat-value">{formatDate(selectedGoal.created_at)}</span>
            </div>
          </div>
        </div>

        <!-- Chart Section -->
        <div class="detail-chart">
          <h4>Progress Over Time</h4>
          {#if hasHistory}
            <svg viewBox="0 0 400 150" class="chart-svg">
              <!-- Grid lines -->
              <line x1="50" y1="10" x2="50" y2="130" stroke="var(--border-primary)" stroke-width="1" />
              <line x1="50" y1="130" x2="390" y2="130" stroke="var(--border-primary)" stroke-width="1" />

              <!-- Y-axis labels -->
              <text x="45" y="15" text-anchor="end" class="chart-label">{formatCurrency(chartData.maxY)}</text>
              <text x="45" y="75" text-anchor="end" class="chart-label">{formatCurrency((chartData.maxY + chartData.minY) / 2)}</text>
              <text x="45" y="132" text-anchor="end" class="chart-label">{formatCurrency(chartData.minY)}</text>

              <!-- Target line -->
              <line
                x1="50"
                y1={targetY}
                x2="390"
                y2={targetY}
                stroke="var(--accent-success)"
                stroke-width="1"
                stroke-dasharray="4,4"
                opacity="0.6"
              />
              <text x="392" y={targetY + 4} class="chart-label target">Goal</text>

              <!-- Balance line -->
              <path
                d={chartData.path}
                fill="none"
                stroke={selectedGoal.color}
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />

              <!-- Data points -->
              {#each chartData.points as point, i}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r="4"
                  fill={selectedGoal.color}
                  stroke="var(--bg-secondary)"
                  stroke-width="2"
                />
              {/each}

              <!-- X-axis labels (first and last date) -->
              {#if chartData.points.length >= 2}
                <text x={chartData.points[0].x} y="145" text-anchor="middle" class="chart-label">
                  {new Date(chartData.points[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </text>
                <text x={chartData.points[chartData.points.length - 1].x} y="145" text-anchor="middle" class="chart-label">
                  {new Date(chartData.points[chartData.points.length - 1].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </text>
              {/if}
            </svg>
          {:else}
            <div class="chart-empty">
              <p>No history data yet.</p>
              <p class="hint">Progress will be tracked as account balances change over time.</p>
            </div>
          {/if}
        </div>

        <!-- Linked accounts info -->
        {#if selectedGoal.allocations && selectedGoal.allocations.length > 0}
          <div class="detail-accounts">
            <h4>Linked Accounts</h4>
            <div class="account-list">
              {#each selectedGoal.allocations as alloc}
                {@const account = accounts.find((a) => a.account_id === alloc.account_id)}
                {#if account}
                  <div class="account-item">
                    <span class="account-name">{account.name}</span>
                    <span class="account-allocation">
                      {#if alloc.allocation_type === "percentage"}
                        {alloc.allocation_value}% of balance
                      {:else}
                        {formatCurrency(alloc.allocation_value)} allocated
                      {/if}
                    </span>
                    <span class="account-balance">{formatCurrency(account.balance)}</span>
                  </div>
                {/if}
              {/each}
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .view {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: var(--spacing-md) var(--spacing-lg);
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-primary);
  }

  .header h1 {
    font-size: 18px;
    font-weight: 600;
    margin: 0;
  }

  .loading,
  .error,
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    color: var(--text-muted);
    gap: var(--spacing-md);
    padding: var(--spacing-xl);
    text-align: center;
  }

  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border-primary);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .content {
    flex: 1;
    overflow-y: auto;
    padding: var(--spacing-lg);
  }

  .goals-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: var(--spacing-lg);
  }

  .goal-card {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 8px;
    padding: var(--spacing-md);
    overflow: hidden;
  }

  .goal-image {
    margin: calc(-1 * var(--spacing-md));
    margin-bottom: var(--spacing-md);
    height: 120px;
    overflow: hidden;
  }

  .goal-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .goal-header {
    display: flex;
    align-items: flex-start;
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }

  .goal-icon {
    font-size: 24px;
    line-height: 1;
  }

  .goal-title {
    flex: 1;
    min-width: 0;
  }

  .goal-title h3 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .goal-date {
    font-size: 12px;
    color: var(--text-muted);
  }

  .goal-actions {
    display: flex;
    gap: 4px;
  }

  .btn-icon {
    background: none;
    border: none;
    padding: 4px;
    cursor: pointer;
    opacity: 0.4;
    color: var(--text-secondary);
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .btn-icon:hover {
    opacity: 1;
    color: var(--text-primary);
  }

  .goal-progress {
    margin-bottom: var(--spacing-md);
  }

  .progress-bar {
    height: 8px;
    background: var(--bg-tertiary);
    border-radius: 4px;
    overflow: visible;
    margin-bottom: var(--spacing-xs);
    position: relative;
  }

  .progress-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.3s ease;
  }

  .milestone-markers {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .milestone {
    position: absolute;
    top: -2px;
    width: 2px;
    height: 12px;
    background: var(--border-primary);
    opacity: 0.5;
    transform: translateX(-50%);
  }

  .progress-labels {
    display: flex;
    justify-content: space-between;
    font-size: 12px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .progress-percent {
    font-weight: 600;
    color: var(--text-primary);
  }

  .goal-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: var(--spacing-sm);
    margin-bottom: var(--spacing-md);
  }

  .stat {
    text-align: center;
    padding: var(--spacing-sm);
    background: var(--bg-tertiary);
    border-radius: 4px;
  }

  .stat-label {
    display: block;
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
    margin-bottom: 2px;
  }

  .stat-value {
    font-size: 13px;
    font-weight: 600;
    font-family: var(--font-mono);
  }

  .stat-value.on-track {
    color: var(--accent-success);
  }

  .stat-value.behind {
    color: var(--accent-warning);
  }

  .goal-accounts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    margin-bottom: var(--spacing-md);
  }

  .accounts-label {
    font-size: 11px;
    color: var(--text-muted);
  }

  .account-tag {
    font-size: 11px;
    padding: 2px 6px;
    background: var(--bg-tertiary);
    border-radius: 4px;
    color: var(--text-secondary);
  }

  .completed-section {
    margin-top: var(--spacing-xl);
    border-top: 1px solid var(--border-primary);
    padding-top: var(--spacing-md);
  }

  .completed-toggle {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 13px;
    padding: var(--spacing-sm) 0;
  }

  .completed-toggle:hover {
    color: var(--text-primary);
  }

  .completed-list {
    margin-top: var(--spacing-sm);
  }

  .completed-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm);
    border-radius: 4px;
  }

  .completed-item:hover {
    background: var(--bg-secondary);
  }

  .completed-name {
    flex: 1;
    font-size: 13px;
  }

  .completed-amount {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-muted);
  }

  .completed-date {
    font-size: 12px;
    color: var(--text-muted);
  }

  /* Buttons */
  .btn {
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: all 0.15s ease;
  }

  .btn.primary {
    background: var(--accent-primary);
    color: white;
  }

  .btn.primary:hover {
    opacity: 0.9;
  }

  .btn.secondary {
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    color: var(--text-primary);
  }

  .btn.success {
    background: var(--accent-success);
    color: white;
  }

  .btn.text {
    background: none;
    padding: 4px 8px;
    color: var(--text-secondary);
  }

  .btn.text:hover {
    color: var(--text-primary);
  }

  .btn.text.danger:hover {
    color: var(--accent-danger);
  }

  .btn.small {
    font-size: 11px;
    padding: 4px 8px;
  }

  .btn.full-width {
    width: 100%;
  }

  /* Modal */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--bg-secondary);
    border: 1px solid var(--border-primary);
    border-radius: 8px;
    padding: var(--spacing-lg);
    width: 520px;
    max-width: 95vw;
    max-height: 85vh;
    overflow-y: auto;
  }

  .modal h3 {
    margin: 0 0 var(--spacing-md) 0;
    font-size: 16px;
    font-weight: 600;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-md);
  }

  .form-group {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .form-label {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
    font-size: 13px;
    color: var(--text-secondary);
  }

  .form-label.color-label {
    width: 100px;
  }

  .form-label input {
    padding: 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 14px;
  }

  .form-label input:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .emoji-picker {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
  }

  .emoji-btn {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 18px;
    background: transparent;
    border: 2px solid transparent;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .emoji-btn:hover {
    background: var(--bg-tertiary);
  }

  .emoji-btn.selected {
    border-color: var(--accent-primary);
    background: var(--bg-secondary);
  }

  .emoji-custom {
    width: 40px;
    height: 32px;
    text-align: center;
    font-size: 16px;
    padding: 4px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    color: var(--text-primary);
  }

  .emoji-custom:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .emoji-custom::placeholder {
    color: var(--text-muted);
    font-size: 12px;
  }

  .color-input {
    height: 38px;
    padding: 4px !important;
    cursor: pointer;
  }

  .form-hint {
    font-size: 11px;
    color: var(--text-muted);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--spacing-sm);
    margin-top: var(--spacing-lg);
  }

  /* Allocations */
  .allocations-section {
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    padding: var(--spacing-md);
    background: var(--bg-tertiary);
  }

  .allocations-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-sm);
  }

  .allocations-header .form-label {
    margin: 0;
    font-weight: 500;
  }

  .allocation-row {
    display: flex;
    gap: var(--spacing-sm);
    align-items: center;
    margin-bottom: var(--spacing-sm);
  }

  .allocation-row:last-child {
    margin-bottom: 0;
  }

  .allocation-account,
  .allocation-type {
    padding: 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 13px;
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    cursor: pointer;
  }

  .allocation-account {
    flex: 1;
    min-width: 0;
    padding-right: 28px;
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .allocation-type {
    width: 55px;
    min-width: 55px;
    flex-shrink: 0;
    padding-right: 20px;
    background-position: right 4px center;
  }

  .allocation-account:focus,
  .allocation-type:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .allocation-account option,
  .allocation-type option {
    background: var(--bg-secondary);
    color: var(--text-primary);
    padding: 8px;
  }

  .allocation-value {
    width: 70px;
    min-width: 70px;
    flex-shrink: 0;
    padding: 8px;
    background: var(--bg-primary);
    border: 1px solid var(--border-primary);
    border-radius: 4px;
    color: var(--text-primary);
    font-size: 13px;
    font-family: var(--font-mono);
    /* Hide native number spinners */
    -moz-appearance: textfield;
  }

  .allocation-value::-webkit-outer-spin-button,
  .allocation-value::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  .allocation-value:focus {
    outline: none;
    border-color: var(--accent-primary);
  }

  .btn-icon.danger:hover {
    color: var(--accent-danger);
  }

  /* Confetti */
  .confetti-container {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 1000;
    overflow: hidden;
  }

  .confetti {
    position: absolute;
    width: 10px;
    height: 10px;
    background: var(--color);
    top: -10px;
    left: var(--x);
    opacity: 0;
    transform: rotate(var(--rotation));
    animation: confetti-fall 3s ease-out var(--delay) forwards;
  }

  .confetti:nth-child(odd) {
    width: 8px;
    height: 12px;
    border-radius: 2px;
  }

  .confetti:nth-child(even) {
    width: 12px;
    height: 8px;
    border-radius: 50%;
  }

  @keyframes confetti-fall {
    0% {
      opacity: 1;
      top: -10px;
      transform: rotate(var(--rotation)) translateX(0);
    }
    100% {
      opacity: 0;
      top: 100vh;
      transform: rotate(calc(var(--rotation) + 720deg)) translateX(calc(var(--x) * 0.2 - 10vw));
    }
  }

  /* Detail Modal */
  .detail-modal {
    width: 600px;
    max-width: 95vw;
  }

  .detail-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: var(--spacing-md);
  }

  .detail-title {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
  }

  .goal-icon.large {
    font-size: 36px;
  }

  .detail-header h3 {
    margin: 0;
    font-size: 20px;
    font-weight: 600;
  }

  .btn-icon.close {
    opacity: 0.6;
  }

  .btn-icon.close:hover {
    opacity: 1;
  }

  .detail-image {
    margin: 0 calc(-1 * var(--spacing-lg));
    margin-bottom: var(--spacing-lg);
    height: 160px;
    overflow: hidden;
  }

  .detail-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .detail-progress {
    margin-bottom: var(--spacing-lg);
  }

  .progress-bar.large {
    height: 12px;
    margin-bottom: var(--spacing-md);
  }

  .progress-amounts {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: var(--spacing-md);
  }

  .amount-current,
  .amount-target {
    text-align: center;
  }

  .amount-value {
    display: block;
    font-size: 18px;
    font-weight: 600;
    font-family: var(--font-mono);
  }

  .amount-label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .amount-percent {
    font-size: 28px;
    font-weight: 700;
    color: var(--accent-primary);
  }

  .detail-stats {
    display: flex;
    gap: var(--spacing-md);
    justify-content: center;
  }

  .detail-stats .stat {
    flex: 1;
    max-width: 150px;
  }

  /* Chart */
  .detail-chart {
    background: var(--bg-tertiary);
    border-radius: 8px;
    padding: var(--spacing-md);
    margin-bottom: var(--spacing-md);
  }

  .detail-chart h4 {
    margin: 0 0 var(--spacing-sm) 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .chart-svg {
    width: 100%;
    height: auto;
  }

  .chart-label {
    font-size: 9px;
    fill: var(--text-muted);
    font-family: var(--font-mono);
  }

  .chart-label.target {
    fill: var(--accent-success);
    font-size: 8px;
  }

  .chart-empty {
    text-align: center;
    padding: var(--spacing-lg);
    color: var(--text-muted);
  }

  .chart-empty p {
    margin: 0;
  }

  .chart-empty .hint {
    font-size: 12px;
    margin-top: var(--spacing-xs);
    opacity: 0.7;
  }

  /* Linked accounts in detail */
  .detail-accounts {
    border-top: 1px solid var(--border-primary);
    padding-top: var(--spacing-md);
  }

  .detail-accounts h4 {
    margin: 0 0 var(--spacing-sm) 0;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .account-list {
    display: flex;
    flex-direction: column;
    gap: var(--spacing-xs);
  }

  .account-item {
    display: flex;
    align-items: center;
    gap: var(--spacing-md);
    padding: var(--spacing-sm);
    background: var(--bg-tertiary);
    border-radius: 4px;
  }

  .account-name {
    flex: 1;
    font-weight: 500;
  }

  .account-allocation {
    font-size: 12px;
    color: var(--text-muted);
  }

  .account-balance {
    font-family: var(--font-mono);
    font-size: 13px;
  }

  /* Make goal cards look clickable */
  .goal-card {
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .goal-card:hover {
    border-color: var(--accent-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
</style>
