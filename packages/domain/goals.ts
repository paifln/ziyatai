// Constructors keep the generated Lite bundle valid ES5. Older school browsers
// use the Latin/Cyrillic alphabets of the two supported interface languages.
const letters = "A-Za-z\\u0400-\\u052F";
let goalLetters: RegExp;
let assessmentTopic: RegExp;
try {
  goalLetters = new RegExp("\\p{L}", "u");
  assessmentTopic = new RegExp(
    "(?:^|[^\\p{L}\\p{N}])(?:СОР|СОЧ|БЖБ|ТЖБ)(?=$|[^\\p{L}\\p{N}])",
    "iu",
  );
} catch {
  goalLetters = new RegExp("[" + letters + "]");
  assessmentTopic = new RegExp(
    "(?:^|[^" + letters + "0-9])(?:СОР|СОЧ|БЖБ|ТЖБ)(?=$|[^" + letters + "0-9])",
    "i",
  );
}
/** Objective codes and punctuation alone are not a learning-objective description. */
export function hasGoalText(value: string) {
  return goalLetters.test(value);
}

/** Only explicit summative-assessment rows may omit objectives. */
export function isAssessmentTopic(topic: string) {
  return assessmentTopic.test(topic);
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
