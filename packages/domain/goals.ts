/** Objective codes and punctuation alone are not a learning-objective description. */
export function hasGoalText(value: string) {
  return /\p{L}/u.test(value);
}

/** Only explicit summative-assessment rows may omit objectives. */
export function isAssessmentTopic(topic: string) {
  return /(?:^|[^\p{L}\p{N}])(?:СОР|СОЧ|БЖБ|ТЖБ)(?=$|[^\p{L}\p{N}])/iu.test(
    topic,
  );
}
export function maySkipGoals(row: { topic: string; goalsSkipped?: boolean }) {
  return row.goalsSkipped === true && isAssessmentTopic(row.topic);
}
export function hasRequiredGoals(row: {
  topic: string;
  goals: string;
  goalsSkipped?: boolean;
}) {
  return maySkipGoals(row) || hasGoalText(row.goals);
}
