/** Objective codes and punctuation alone are not a learning-objective description. */
export function hasGoalText(value: string) {
  return /\p{L}/u.test(value);
}
