  function renderPlan() {
    clear(plan.title, "ktp");
    bindDraft("ktp");
    var actions = add(content, el("div", null, "actions"));
    add(
      actions,
      button(t("refresh"), function () {
        openPlan(plan.id);
      })
    );
    if (plan.status === "extracting") {
      add(content, el("p", t("processing"), "notice"));
      return;
    }
    if (plan.status === "failed") {
      add(content, el("p", t("failed"), "notice"));
      return;
    }
    add(content, el("p", t(plan.status) + " · " + t("needsReview"), "notice"));
    var settings = add(content, el("div", null, "fields")),
      grades = [["", text("Таңдаңыз", "Выберите")]];
    for (var i = 1; i <= 11; i++) grades.push([String(i), String(i)]);
    var planGrade = select(
      settings,
      t("grade"),
      grades,
      String(plan.grade || ""),
      function (v) {
        plan.grade = v ? Number(v) : null;
        changed();
      }
    );
    planGrade.id = "lite-plan-grade";
    field(settings, t("year"), plan.school_year, "text", function (v) {
      plan.school_year = v;
      changed();
    });
    var skipDates = add(
      actions,
      button(
        datesBeforeSkip
          ? text("Күндерді қайтару", "Вернуть даты")
          : text("Барлық күндерді өткізу", "Пропустить все даты"),
        function () {
          if (datesBeforeSkip) {
            plan.rows.forEach(function (r, i) {
              var old = datesBeforeSkip[i];
              r.dateRaw = old.dateRaw;
              r.dateStart = old.dateStart;
              r.dateEnd = old.dateEnd;
              r.dateSkipped = old.dateSkipped;
              r.warnings = r.warnings
                .filter(function (w) {
                  return w.indexOf("date") < 0;
                })
                .concat(
                  old.warnings.filter(function (w) {
                    return w.indexOf("date") >= 0;
                  })
                );
            });
            datesBeforeSkip = null;
            changed();
            renderPlan();
          } else
            confirmAction(
              text(
                "Барлық сабақ күндерін өткізу керек пе? Сақтағанға дейін қайтаруға болады.",
                "Пропустить даты всех уроков? До сохранения их можно вернуть."
              ),
              function () {
                datesBeforeSkip = JSON.parse(JSON.stringify(plan.rows));
                plan.rows.forEach(function (r) {
                  r.dateRaw = "";
                  r.dateStart = null;
                  r.dateEnd = null;
                  r.dateSkipped = true;
                  r.warnings = r.warnings.filter(function (w) {
                    return w.indexOf("date") < 0;
                  });
                });
                changed();
                renderPlan();
              }
            );
        }
      )
    );
    skipDates.title = text(
      "Барлық беттердегі күндерді өткізу",
      "Пропустить даты на всех страницах"
    );
    function save(confirm) {
      action(
        "ktp/" + plan.id + "/" + (confirm ? "confirm" : "rows"),
        {
          revision: plan.revision,
          rows: plan.rows || [],
          grade: plan.grade,
          schoolYear: plan.school_year || "",
        },
        function (saved) {
          plan.revision = saved.revision;
          plan.status = confirm ? "confirmed" : "review";
          dirty = false;
          if (draftSession) draftSession.accepted();
          updatePlanAction();
          openPlan(plan.id);
          note(t("saved"));
        },
        confirm ? "POST" : "PATCH"
      );
    }
    add(
      actions,
      button(t("save"), function () {
        save(false);
      })
    );
    var confirmPlan = add(
      actions,
      button(
        t("confirm"),
        function () {
          save(true);
        },
        true
      )
    );
    confirmPlan.id = "confirm-plan";
    if (plan.rows && plan.rows.length) {
      var readiness = add(content, el("section", null, "panel"));
      readiness.setAttribute(
        "aria-label",
        text("КТЖ растауға дайындығы", "Готовность КТП к подтверждению")
      );
      add(readiness, el("p")).id = "plan-readiness";
      document.getElementById("plan-readiness").setAttribute("role", "status");
      var firstIssue = add(
        readiness,
        button(
          text("Бірінші бос өріске өту", "К первому пропуску"),
          function () {
            var row = incompletePlanRows()[0];
            if (!row) return;
            classFilter = "";
            rowPage = Math.floor(plan.rows.indexOf(row) / 10);
            var field = !row.topic.trim()
              ? "topic"
              : !window.ZiyatCurriculum.hasRequiredGoals(row)
                ? "goals"
                : "grade";
            renderPlan();
            var target =
              field === "grade"
                ? document.getElementById("lite-plan-grade")
                : document
                    .getElementById("lite-row-" + row.id)
                    .querySelector('[data-review-field="' + field + '"]');
            if (target) target.focus();
          }
        )
      );
      firstIssue.id = "first-plan-issue";
    }
    updatePlanAction();
    if (plan.status === "confirmed") {
      var create = add(
        actions,
        button(
          t("generate"),
          function () {
            generateForm();
          },
          true
        )
      );
      create.setAttribute("data-confirmed-plan", "true");
      create.setAttribute("aria-describedby", "plan-generation-warning");
      create.title = t("saveBeforeGenerate");
      var hint = add(content, el("p", t("saveBeforeGenerate"), "notice"));
      hint.id = "plan-generation-warning";
      updatePlanAction();
    }
    if (plan.file_id) renderSourceAccess(plan.id, plan.file_id);
    var rows = plan.rows || [];
    var classes = [];
    rows.forEach(function (r) {
      var g = gradeOf(r);
      if (g && classes.indexOf(g) < 0) classes.push(g);
    });
    classes.sort(function (a, b) {
      return a - b;
    });
    select(
      content,
      text("Сыныпты көрсету", "Показать класс"),
      [["", text("Барлық сыныптар", "Все классы")]].concat(
        classes.map(function (g) {
          return [String(g), String(g)];
        })
      ),
      classFilter,
      function (value) {
        classFilter = value;
        rowPage = 0;
        renderPlan();
      }
    );
    var panel = add(content, el("section", null, "panel"));
    var visibleRows = rows.filter(function (r) {
      return !classFilter || String(gradeOf(r)) === classFilter;
    });
    visibleRows
      .slice(rowPage * 10, rowPage * 10 + 10)
      .forEach(function (r, offset) {
        var section = add(panel, el("section", null, "row"));
        section.id = "lite-row-" + r.id;
        add(
          section,
          el(
            "h2",
            String(rowPage * 10 + offset + 1) + ". " + (r.topic || t("topic"))
          )
        );
        function update(key, value) {
          r[key] = value;
          changed();
          if (r.source) r.source.method = "manual";
        }
        field(section, t("topic"), r.topic, "textarea", function (v) {
          update("topic", v);
        }).setAttribute("data-review-field", "topic");
        field(section, t("goals"), r.goals, "textarea", function (v) {
          r.goalsSkipped = false;
          update("goals", v);
        }).setAttribute("data-review-field", "goals");
        if (window.ZiyatCurriculum.isAssessmentTopic(r.topic)) {
          var skipGoals = add(
            section,
            button(
              r.goalsSkipped
                ? text("Мақсаттарды қайтару", "Вернуть цели")
                : text("Мақсатсыз · БЖБ/ТЖБ", "Без целей · СОР/СОЧ"),
              function () {
                r.goalsSkipped = !r.goalsSkipped;
                changed();
                renderPlan();
              }
            )
          );
          skipGoals.setAttribute("aria-pressed", String(!!r.goalsSkipped));
          skipGoals.title = text(
            "Бастапқы мәтін сақталады",
            "Исходный текст сохранится"
          );
        }
        var pair = add(section, el("div", null, "fields"));
        field(pair, t("date"), r.dateRaw, "text", function (v) {
          r.dateSkipped = false;
          update("dateRaw", v);
        });
        field(pair, t("hours"), r.hours, "text", function (v) {
          update("hours", v);
        });
        var details = add(section, el("details"));
        add(details, el("summary", t("source")));
        add(details, el("p", (r.source && r.source.fragment) || "—", "source"));
        if (r.warnings && r.warnings.length)
          add(section, el("p", t("needsReview"), "muted"));
      });
    if (plan.unrecognized && plan.unrecognized.length) {
      var fragments = add(content, el("details", null, "panel"));
      add(
        fragments,
        el(
          "summary",
          text("Танылмаған фрагменттер", "Нераспознанные фрагменты")
        )
      );
      plan.unrecognized.forEach(function (f) {
        add(fragments, el("p", f, "source"));
      });
    }
    var pages = add(content, el("div", null, "pagination"));
    add(
      pages,
      el(
        "span",
        String(rowPage * 10 + 1) +
          "–" +
          Math.min(visibleRows.length, rowPage * 10 + 10) +
          " / " +
          visibleRows.length
      )
    );
    if (rowPage > 0)
      add(
        pages,
        button(t("prev"), function () {
          rowPage--;
          renderPlan();
          window.scrollTo(0, 0);
        })
      );
    if ((rowPage + 1) * 10 < visibleRows.length)
      add(
        pages,
        button(t("next"), function () {
          rowPage++;
          renderPlan();
          window.scrollTo(0, 0);
        })
      );
  }
