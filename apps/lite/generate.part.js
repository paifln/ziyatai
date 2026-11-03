  function generateForm() {
    if (!plan || dirty || plan.status !== "confirmed") {
      note(t("saveBeforeGenerate"), true);
      return;
    }
    clear(t("generate"));
    if (!profile.capabilities.ai) {
      add(content, el("p", t("unavailable"), "notice"));
      return;
    }
    var form = add(content, el("form", null, "panel")),
      rows = plan.rows || [];
    var grades = [],
      unknownGrade = false;
    rows.forEach(function (item) {
      var value = gradeOf(item);
      if (!value) unknownGrade = true;
      else if (grades.indexOf(value) < 0) grades.push(value);
    });
    grades.sort(function (a, b) {
      return a - b;
    });
    var options = grades.map(function (value) {
      return [String(value), String(value)];
    });
    if (unknownGrade)
      options.push([
        "unknown",
        text("Сынып анықталмаған", "Класс не определён"),
      ]);
    var initialGrade =
      grades.indexOf(Number(classFilter)) >= 0
        ? classFilter
        : grades.indexOf(Number(plan.grade)) >= 0
          ? String(plan.grade)
          : grades.length
            ? String(grades[0])
            : "unknown";
    var grade = select(form, t("grade"), options, initialGrade, function () {
      updateTopics();
    });
    var search = field(
      form,
      text("Тақырыпты іздеу", "Найти тему"),
      "",
      "search",
      function () {
        updateTopics();
      }
    );
    search.maxLength = 200;
    var row = select(form, t("topic"), [], "");
    var result = add(form, el("p", "", "muted"));
    result.setAttribute("role", "status");
    result.setAttribute("aria-live", "polite");
    var lang = select(
      form,
      t("locale"),
      [
        ["kk", "Қазақша"],
        ["ru", "Русский"],
        ["kk+ru", "Қазақша + Русский"],
      ],
      locale
    );
    var pair = add(form, el("div", null, "fields"));
    var count = field(pair, t("count"), 3, "number");
    count.min = 1;
    count.max = 5;
    var minutes = field(pair, t("minutes"), 30, "number");
    minutes.min = 5;
    minutes.max = 120;
    var format = select(
      form,
      t("format"),
      ["mixed", "theory", "programming", "logic"].map(function (k) {
        return [k, t(k)];
      }),
      "mixed"
    );
    var constraints = field(form, t("constraints"), "", "textarea");
    constraints.maxLength = 2000;
    var submit = add(form, el("button", t("generate"), "primary"));
    submit.type = "submit";
    function updateTopics() {
      var previous = row.value,
        query = search.value.toLowerCase().trim();
      var matches = rows.filter(function (item) {
        return (
          String(gradeOf(item) || "unknown") === grade.value &&
          (item.topic + " " + item.goals + " " + item.section)
            .toLowerCase()
            .indexOf(query) >= 0
        );
      });
      row.textContent = "";
      matches.forEach(function (item) {
        var option = el("option", item.topic);
        option.value = item.id;
        add(row, option);
      });
      if (
        matches.some(function (item) {
          return item.id === previous;
        })
      )
        row.value = previous;
      row.disabled = !matches.length;
      submit.disabled = !matches.length || grade.value === "unknown";
      result.textContent = matches.length
        ? text("Табылған тақырыптар: ", "Найдено тем: ") + matches.length
        : text(
            "Бұл сыныпта сәйкес тақырып табылмады. Іздеуді өзгертіңіз.",
            "В этом классе подходящих тем нет. Измените поиск."
          );
      if (grade.value === "unknown" && matches.length)
        result.textContent = text(
          "Алдымен КТЖ-дағы сыныпты көрсетіңіз.",
          "Сначала укажите класс при проверке КТП."
        );
    }
    updateTopics();
    form.onsubmit = function (e) {
      e.preventDefault();
      if (row.disabled || !row.value || grade.value === "unknown") return;
      action(
        "generations",
        {
          planId: plan.id,
          rowId: row.value,
          revision: plan.revision,
          locale: lang.value,
          count: Number(count.value),
          minutes: Number(minutes.value),
          format: format.value,
          constraints: constraints.value,
        },
        function (g) {
          plan = null;
          openGeneration(g.id);
        }
      );
    };
  }
