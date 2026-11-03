/* Generated from packages/domain/goals.ts by npm run build:lite. */
(function (root) {
  "use strict";
  var exports = {};
  ("use strict");
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.hasGoalText = hasGoalText;
  exports.isAssessmentTopic = isAssessmentTopic;
  exports.maySkipGoals = maySkipGoals;
  exports.hasRequiredGoals = hasRequiredGoals;
  var letters = "A-Za-z\\u0400-\\u052F";
  var goalLetters;
  var assessmentTopic;
  try {
    goalLetters = new RegExp("\\p{L}", "u");
    assessmentTopic = new RegExp(
      "(?:^|[^\\p{L}\\p{N}])(?:СОР|СОЧ|БЖБ|ТЖБ)(?=$|[^\\p{L}\\p{N}])",
      "iu"
    );
  } catch (_a) {
    goalLetters = new RegExp("[" + letters + "]");
    assessmentTopic = new RegExp(
      "(?:^|[^" +
        letters +
        "0-9])(?:СОР|СОЧ|БЖБ|ТЖБ)(?=$|[^" +
        letters +
        "0-9])",
      "i"
    );
  }
  function hasGoalText(value) {
    return goalLetters.test(value);
  }
  function isAssessmentTopic(topic) {
    return assessmentTopic.test(topic);
  }
  function maySkipGoals(row) {
    return row.goalsSkipped === true && isAssessmentTopic(row.topic);
  }
  function hasRequiredGoals(row) {
    return maySkipGoals(row) || hasGoalText(row.goals);
  }

  root.ZiyatCurriculum = exports;
})(window);
