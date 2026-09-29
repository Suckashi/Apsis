export const TASK_NAVIGATION_KEY = "apsis.task-navigation.v1";

export interface TaskNavigation {
  tabs: string[];
  activeTask?: string;
}

/** Restore only tasks confirmed by the current workspace snapshot. */
export function restoreTaskNavigation(
  saved: string | null,
  available: readonly { id: string }[],
): TaskNavigation {
  const empty: TaskNavigation = { tabs: [] };
  if (!saved) return empty;
  try {
    const value: unknown = JSON.parse(saved);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return empty;
    const record = value as Record<string, unknown>;
    if (!Array.isArray(record.tabs)) return empty;
    const known = new Set(available.map((task) => task.id));
    const tabs = [
      ...new Set(
        record.tabs.filter(
          (id): id is string => typeof id === "string" && known.has(id),
        ),
      ),
    ];
    const activeTask =
      typeof record.activeTask === "string" && known.has(record.activeTask)
        ? record.activeTask
        : undefined;
    if (activeTask && !tabs.includes(activeTask)) tabs.push(activeTask);
    return { tabs, activeTask };
  } catch {
    return empty;
  }
}
