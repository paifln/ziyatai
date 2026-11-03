  function openGeneration(id) {
    leave(function () {
      invalidateReads();
      var version = viewVersion,
        edits = editVersion;
      pageRead = request(
        "generations/" + encodeURIComponent(id),
        "GET",
        undefined,
        function (err, g) {
          if (version !== viewVersion) return;
          pageRead = null;
          if (edits !== editVersion) return;
          if (err) {
            note(err, true);
            return;
          }
          dirty = false;
          generation = g;
          plan = null;
          activeTask = null;
          wholeDocumentDirty = false;
          renderGeneration();
          bindDraft("generation", true);
        }
      );
    });
  }
  function blocks(parent, data) {
    (data || []).forEach(function (b) {
      if (b.type === "paragraph") add(parent, el("p", b.text));
      else if (b.type === "code") add(parent, el("pre", b.text));
      else if (b.type === "list") {
        var ul = add(parent, el("ul"));
        b.items.forEach(function (item) {
          add(ul, el("li", item));
        });
      } else if (b.type === "table") {
        var wrap = add(parent, el("div", null, "table-scroll")),
          table = add(wrap, el("table")),
          head = add(table, el("tr"));
        b.columns.forEach(function (c) {
          add(head, el("th", c));
        });
        b.rows.forEach(function (r) {
          var tr = add(table, el("tr"));
          r.forEach(function (c) {
            add(tr, el("td", c));
          });
        });
      }
    });
  }
  function renderGeneration() {
    activeTask = null;
    clear(generation.title, "generation");
    bindDraft("generation");
    if (dirty && wholeDocumentDirty)
      add(
        content,
        button(
          t("save"),
          function () {
            var snapshot = draftState("generation").draft;
            action(
              "generations/" + generation.id + "/document",
              { revision: generation.revision, document: snapshot },
              function (saved) {
                acceptGeneration(saved, snapshot);
              },
              "PATCH"
            );
          },
          true
        )
      );
    var actions = add(content, el("div", null, "actions"));
    add(
      actions,
      button(t("refresh"), function () {
        openGeneration(generation.id);
      })
    );
    add(
      actions,
      link(
        t("advancedEditor"),
        "/?generation=" + encodeURIComponent(generation.id)
      )
    );
    if (!generation.document) {
      add(content, el("p", t("processing"), "notice"));
      return;
    }
    add(
      content,
      el("p", generation.demo ? t("demo") : t("needs_review"), "notice")
    );
    var audience = select(
      content,
      t("export"),
      [
        ["full", t("full")],
        ["student", t("student")],
      ],
      "full"
    );
    var reviewLabel = add(content, el("label")),
      review = add(reviewLabel, el("input"));
    review.type = "checkbox";
    review.checked = !!generation.reviewed_at;
    review.disabled = !!generation.reviewed_at;
    add(
      reviewLabel,
      document.createTextNode(
        " " +
          text(
            "Тапсырмаларды, жауаптар мен критерийлерді тексердім",
            "Я проверил(а) задания, ответы и критерии"
          )
      )
    );
    add(
      content,
      el(
        "small",
        text(
          "Алдымен тапсырмалар мен жауаптарды тексеріп, мақұлдаңыз. Файлдар содан кейін қолжетімді болады.",
          "Сначала проверьте задания и ответы, затем одобрите их. После этого станут доступны файлы."
        )
      )
    );
    if (!generation.reviewed_at) {
      var approve = add(
        content,
        button(
          text("Тапсырмаларды мақұлдау", "Одобрить задания"),
          function () {
            if (!review.checked || dirty) return;
            action(
              "generations/" + generation.id + "/approve",
              { revision: generation.revision, teacherReviewed: true },
              function () {
                openGeneration(generation.id);
              }
            );
          },
          true
        )
      );
      approve.disabled = true;
      review.onchange = function () {
        approve.disabled = !review.checked || dirty;
      };
    } else
      add(
        content,
        el("p", text("Мұғалім мақұлдады", "Одобрено учителем"), "notice")
      );
    var layout = select(
      content,
      text("Басып шығару макеті", "Макет печати"),
      [
        ["portrait", text("A4 · тік", "A4 · книжный")],
        [
          "landscape-columns",
          text("A4 · көлденең, екі баған", "A4 · альбомный, две колонки"),
        ],
      ],
      "portrait"
    );
    ["docx", "pdf"].forEach(function (format) {
      var exportButton = add(
        actions,
        button(format.toUpperCase(), function () {
          action(
            "exports",
            {
              generationId: generation.id,
              revision: generation.revision,
              format: format,
              audience: audience.value,
              styles: Object.assign({}, profile.styles || {}, {
                layout: layout.value,
              }),
              teacherReviewed: !!generation.reviewed_at,
            },
            function () {
              go("library");
              note(t("processing"));
            }
          );
        })
      );
      exportButton.disabled = !generation.reviewed_at;
    });
    var panel = add(content, el("section", null, "panel"));
    generation.document.tasks.forEach(function (task, i) {
      var section = add(panel, el("article", null, "task"));
      add(section, el("h2", String(i + 1) + ". " + t(task.level)));
      add(
        section,
        el(
          "small",
          task.points +
            " " +
            text("балл", "баллов") +
            " · " +
            task.estimatedMinutes +
            " " +
            text("минут", "минут")
        )
      );
      blocks(section, task.contentBlocks);
      if (task.translation) {
        var translation = add(section, el("div"));
        blocks(translation, task.translation.contentBlocks);
      }
      var answers = add(section, el("details"));
      add(answers, el("summary", t("answer")));
      blocks(answers, task.answerBlocks);
      add(answers, el("h3", t("how")));
      add(answers, el("p", task.explanationHow));
      add(answers, el("h3", t("why")));
      add(answers, el("p", task.explanationWhy));
      if (task.translation) {
        blocks(answers, task.translation.answerBlocks);
        add(answers, el("p", task.translation.explanationHow));
        add(answers, el("p", task.translation.explanationWhy));
      }
      var criteria = add(answers, el("ul"));
      task.rubric.forEach(function (c) {
        add(criteria, el("li", c.criterion + " — " + c.points));
      });
      add(
        section,
        button(t("edit") + " " + String(i + 1), function () {
          editTask(i);
        })
      );
    });
  }
