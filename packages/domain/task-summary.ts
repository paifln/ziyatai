import type { TaskDocument } from "../contracts";

export const taskLevels = ["easy", "medium", "advanced"] as const;

// Levels are alternative workloads for different pupils, not one combined lesson.
export function summarizeTasks(tasks: readonly TaskDocument[]) {
  return taskLevels.map((level) => {
    const group = tasks.filter((task) => task.level === level);
    return {
      level,
      count: group.length,
      minutes: group.reduce((sum, task) => sum + task.estimatedMinutes, 0),
      points: group.reduce((sum, task) => sum + task.points, 0),
    };
  });
}
