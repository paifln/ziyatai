  function editTask(index) {
    var draft = JSON.parse(JSON.stringify(generation.document.tasks[index]));
    activeTask = { index: index, draft: draft };
    clear(t("edit") + " — " + String(index + 1), "generation");
    bindDraft("generation");
    add(
      content,
      el(
        "p",
        text(
          "Өзгерістер жаңа нұсқа ретінде сақталады. Деңгей мен оқу мақсаты өзгермейді.",
          "Изменения сохранятся новой версией. Уровень и привязка к цели сохраняются."
        ),
        "muted"
      )
    );
    var form = add(content, el("form", null, "panel"));
    function editBlocks(parent, title, data) {
      add(parent, el("h3", title));
      data.forEach(function (block, blockIndex) {
        if (block.type === "table") {
          var frame = add(parent, el("div", null, "table-editor")),
            page = 0;
          function drawTable() {
            frame.textContent = "";
            page = Math.min(
              page,
              Math.max(0, Math.ceil(block.rows.length / 10) - 1)
            );
            var wrap = add(frame, el("div", null, "table-scroll")),
              table = add(wrap, el("table")),
              head = add(table, el("tr"));
            function input(parent, value, label, update) {
              var node = add(parent, el("input"));
              node.value = value;
              node.setAttribute("aria-label", label);
              node.oninput = function () {
                update(node.value);
                changed();
              };
            }
            block.columns.forEach(function (column, col) {
              var th = add(head, el("th"));
              th.scope = "col";
              input(
                th,
                column,
                title +
                  " " +
                  String(blockIndex + 1) +
                  " " +
                  text("баған", "столбец") +
                  " " +
                  String(col + 1),
                function (value) {
                  block.columns[col] = value;
                }
              );
            });
            add(head, el("th", t("remove"))).scope = "col";
            block.rows
              .slice(page * 10, page * 10 + 10)
              .forEach(function (row, offset) {
                var ri = page * 10 + offset,
                  tr = add(table, el("tr"));
                row.forEach(function (cell, ci) {
                  input(
                    add(tr, el("td")),
                    cell,
                    title + " " + String(ri + 1) + ", " + String(ci + 1),
                    function (value) {
                      block.rows[ri][ci] = value;
                    }
                  );
                });
                add(
                  add(tr, el("td")),
                  button(t("remove"), function () {
                    block.rows.splice(ri, 1);
                    changed();
                    drawTable();
                  })
                );
              });
            var controls = add(frame, el("div", null, "actions"));
            if (page > 0)
              add(
                controls,
                button(t("prev"), function () {
                  page--;
                  drawTable();
                })
              );
            if ((page + 1) * 10 < block.rows.length)
              add(
                controls,
                button(t("next"), function () {
                  page++;
                  drawTable();
                })
              );
            if (block.rows.length < 200)
              add(
                controls,
                button(text("Жол қосу", "Добавить строку"), function () {
                  block.rows.push(
                    block.columns.map(function () {
                      return "";
                    })
                  );
                  page = Math.floor((block.rows.length - 1) / 10);
                  changed();
                  drawTable();
                })
              );
            if (block.columns.length < 20)
              add(
                controls,
                button(text("Баған қосу", "Добавить столбец"), function () {
                  block.columns.push("");
                  block.rows.forEach(function (row) {
                    row.push("");
                  });
                  changed();
                  drawTable();
                })
              );
          }
          drawTable();
        } else {
          var input = field(
            parent,
            title + " " + String(blockIndex + 1),
            block.type === "list" ? block.items.join("\n") : block.text,
            "textarea",
            function (value) {
              if (block.type === "list") block.items = value.split("\n");
              else block.text = value;
              changed();
            }
          );
          input.maxLength = 20000;
          if (block.type === "code") input.className = "code-input";
        }
      });
    }
    editBlocks(form, t("condition"), draft.contentBlocks);
    editBlocks(form, t("answer"), draft.answerBlocks);
    field(form, t("how"), draft.explanationHow, "textarea", function (v) {
      draft.explanationHow = v;
      changed();
    });
    field(form, t("why"), draft.explanationWhy, "textarea", function (v) {
      draft.explanationWhy = v;
      changed();
    });
    var pair = add(form, el("div", null, "fields"));
    var points = field(pair, t("points"), draft.points, "number", function (v) {
      draft.points = Number(v);
      changed();
    });
    points.min = 1;
    points.max = 100;
    var minutes = field(
      pair,
      t("minutes"),
      draft.estimatedMinutes,
      "number",
      function (v) {
        draft.estimatedMinutes = Number(v);
        changed();
      }
    );
    minutes.min = 1;
    minutes.max = 120;
    draft.rubric.forEach(function (r, i) {
      var fields = add(form, el("div", null, "fields"));
      field(
        fields,
        t("criterion") + " " + String(i + 1),
        r.criterion,
        "text",
        function (v) {
          r.criterion = v;
          changed();
        }
      );
      var score = field(
        fields,
        t("points") + " " + String(i + 1),
        r.points,
        "number",
        function (v) {
          r.points = Number(v);
          changed();
        }
      );
      score.min = 0;
      score.max = 100;
    });
    if (draft.translation) {
      var translated = add(form, el("section"));
      add(translated, el("h2", text("Орысша нұсқа", "Русская версия")));
      editBlocks(translated, t("condition"), draft.translation.contentBlocks);
      editBlocks(translated, t("answer"), draft.translation.answerBlocks);
      field(
        translated,
        t("how"),
        draft.translation.explanationHow,
        "textarea",
        function (v) {
          draft.translation.explanationHow = v;
          changed();
        }
      );
      field(
        translated,
        t("why"),
        draft.translation.explanationWhy,
        "textarea",
        function (v) {
          draft.translation.explanationWhy = v;
          changed();
        }
      );
      draft.translation.rubric.forEach(function (r, i) {
        field(
          translated,
          t("criterion") + " " + String(i + 1),
          r.criterion,
          "text",
          function (v) {
            r.criterion = v;
            changed();
          }
        );
      });
    }
    var actions = add(form, el("div", null, "actions")),
      save = add(actions, el("button", t("save"), "primary"));
    save.type = "submit";
    add(
      actions,
      button(t("discard"), function () {
        leave(function () {
          dirty = false;
          activeTask = null;
          if (draftSession) draftSession.accepted();
          renderGeneration();
        });
      })
    );
    form.onsubmit = function (event) {
      event.preventDefault();
      var snapshot = draftState("generation").draft;
      action(
        wholeDocumentDirty
          ? "generations/" + generation.id + "/document"
          : "generations/" +
              generation.id +
              "/tasks/" +
              encodeURIComponent(draft.id),
        wholeDocumentDirty
          ? { revision: generation.revision, document: snapshot }
          : { revision: generation.revision, task: draft },
        function (saved) {
          acceptGeneration(saved, snapshot);
        },
        "PATCH"
      );
    };
  }
