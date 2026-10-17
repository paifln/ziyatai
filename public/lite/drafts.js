/* Account-backed drafts for Lite. ES5, no framework, local storage or idle polling. */
(function (root) {
  "use strict";
  root.ZiyatLiteDrafts = function (options) {
    var active = true,
      host = null,
      timer = null,
      listing = null,
      reading = null;
    var slot = { id: options.uuid(), sequence: 0, attempted: false };
    var base = copy(options.get().draft),
      used = null,
      lastSaved = null;
    var stage = "idle",
      error = "",
      copies = [],
      loaded = false,
      writing = false;
    var lastAttempt = 0,
      comparison = null,
      restoring = false,
      unlock = null;
    var merge = root.ZiyatDraftMerge;
    function copy(value) {
      return JSON.parse(JSON.stringify(value));
    }
    function say(kk, ru) {
      return options.text(kk, ru);
    }
    function node(tag, text, className, parent) {
      var value = document.createElement(tag);
      if (text !== undefined && text !== null) value.textContent = text;
      if (className) value.className = className;
      if (parent) parent.appendChild(value);
      return value;
    }
    function button(parent, text, click, primary) {
      var value = node("button", text, primary ? "primary" : "", parent);
      value.type = "button";
      value.onclick = click;
      if (!comparison && !restoring && !options.canWrite())
        value.disabled = true;
      return value;
    }
    function resource() {
      return { kind: options.kind, resourceId: options.id };
    }
    function time(value) {
      return new Date(value).toLocaleString(
        options.language() === "ru" ? "ru-RU" : "kk-KZ"
      );
    }
    function discard(id, sequence, done) {
      var body = resource();
      if (sequence !== undefined) body.expectedSequence = sequence;
      options.request("drafts/" + id + "/discard", "POST", body, done);
    }
    function refresh() {
      if (listing) listing.abort();
      listing = options.request(
        "drafts?kind=" + options.kind + "&resourceId=" + options.id,
        "GET",
        undefined,
        function (err, rows) {
          if (!active) return;
          listing = null;
          loaded = true;
          if (err) error = err;
          else {
            copies = rows.filter(function (row) {
              return row.id !== slot.id;
            });
            error = "";
          }
          render();
        }
      );
    }
    function clean() {
      var previous = slot,
        recovered = used;
      slot = { id: options.uuid(), sequence: 0, attempted: false };
      used = null;
      writing = false;
      lastSaved = null;
      stage = "idle";
      error = "";
      if (timer) clearTimeout(timer);
      function removeRecovered() {
        if (!recovered) {
          if (active) refresh();
          return;
        }
        discard(
          recovered.id,
          recovered.sequence,
          function (err, result, status) {
            if (!active) return;
            if (err && status !== 409) error = err;
            refresh();
          }
        );
      }
      if (previous.attempted)
        discard(previous.id, undefined, function (err) {
          if (err && active) {
            error = say(
              "Көшірменің жойылғаны расталмады. Тізімді жаңартыңыз.",
              "Не удалось подтвердить удаление копии. Обновите список."
            );
            render();
          }
          removeRecovered();
        });
      else removeRecovered();
    }
    function schedule() {
      if (timer) clearTimeout(timer);
      if (
        !active ||
        !options.dirty() ||
        comparison ||
        writing ||
        stage === "error"
      )
        return;
      timer = setTimeout(
        saveNow,
        Math.max(1500, lastAttempt + 5000 - Date.now())
      );
    }
    function saveNow() {
      if (!active || !options.dirty() || writing || comparison) return;
      if (!options.canWrite()) {
        schedule();
        return;
      }
      var state = options.get(),
        snapshot = copy(state.draft),
        owner = slot;
      if (
        lastSaved &&
        lastSaved.revision === state.revision &&
        merge.draftsEqual(lastSaved.draft, snapshot)
      ) {
        stage = "saved";
        render();
        return;
      }
      owner.sequence++;
      owner.attempted = true;
      writing = true;
      stage = "saving";
      error = "";
      lastAttempt = Date.now();
      render();
      options.request(
        "drafts",
        "POST",
        {
          id: owner.id,
          sequence: owner.sequence,
          kind: options.kind,
          resourceId: options.id,
          baseRevision: state.revision,
          draft: snapshot,
        },
        function (err, result) {
          if (!active || slot !== owner) return;
          writing = false;
          if (err) {
            error =
              result && result.code === "DRAFT_LIMIT"
                ? say(
                    "Сақтық көшірмелер тым көп. Қажетсіздерін жойыңыз немесе материалды сақтаңыз.",
                    "Слишком много резервных копий. Удалите ненужные или сохраните материал."
                  )
                : err;
            stage = "error";
          } else {
            lastSaved = { revision: state.revision, draft: snapshot };
            stage = state.stamp === options.get().stamp ? "saved" : "pending";
          }
          render();
          if (!err && stage === "pending") schedule();
        }
      );
    }
    function readable(value) {
      if (value === undefined) return say("Жойылды", "Удалено");
      if (value === null || value === "") return "—";
      if (typeof value === "boolean")
        return value ? say("Иә", "Да") : say("Жоқ", "Нет");
      if (Array.isArray(value))
        return value
          .map(function (item, index) {
            return String(index + 1) + ". " + readable(item);
          })
          .join("\n\n");
      if (typeof value === "object") {
        if (value.type === "paragraph" || value.type === "code")
          return value.text;
        if (value.type === "list") return value.items.join("\n• ");
        if (value.type === "table")
          return [value.columns.join(" | ")]
            .concat(
              value.rows.map(function (row) {
                return row.join(" | ");
              })
            )
            .join("\n");
        return Object.keys(value)
          .filter(function (key) {
            return (
              [
                "id",
                "sourceSnapshotId",
                "schemaVersion",
                "sourceOrder",
                "warnings",
                "objectiveCodes",
                "dateStart",
                "dateEnd",
              ].indexOf(key) === -1
            );
          })
          .map(function (key) {
            if (key === "source")
              return value[key] && value[key].sheet
                ? label("sheet") + ": " + value[key].sheet
                : "";
            if (key === "level")
              return (
                label(key) +
                ": " +
                ({ easy: "A", medium: "B", advanced: "C" }[value[key]] ||
                  readable(value[key]))
              );
            return label(key) + ": " + readable(value[key]);
          })
          .join("\n");
      }
      return String(value);
    }
    function label(key) {
      var names = {
        rows: ["Сабақтар", "Уроки"],
        tasks: ["Тапсырмалар", "Задания"],
        topic: ["Тақырып", "Тема"],
        goals: ["Оқу мақсаттары", "Цели обучения"],
        grade: ["Сынып", "Класс"],
        schoolYear: ["Оқу жылы", "Учебный год"],
        contentBlocks: ["Тапсырма шарты", "Условие задания"],
        answerBlocks: ["Жауап", "Ответ"],
        explanationHow: ["Шешуі", "Решение"],
        explanationWhy: ["Түсіндіру", "Объяснение"],
        rubric: ["Критерийлер", "Критерии"],
        notes: ["Ескертпелер", "Примечания"],
        dateRaw: ["Күні", "Дата"],
        section: ["Бөлім", "Раздел"],
        quarter: ["Тоқсан", "Четверть"],
        hours: ["Сағат", "Часы"],
        text: ["Мәтін", "Текст"],
        title: ["Атауы", "Название"],
        criterion: ["Критерий", "Критерий"],
        points: ["Балл", "Баллы"],
        source: ["Дереккөз", "Источник"],
        sheet: ["Парақ", "Лист"],
        level: ["Деңгей", "Уровень"],
        lessonNumberRaw: ["Сабақ нөмірі", "Номер урока"],
        lessonGoals: ["Сабақ мақсаттары", "Цели урока"],
        dateSkipped: ["Күні өткізіп жіберілді", "Дата пропущена"],
        goalsSkipped: ["Мақсаттар өткізіп жіберілді", "Цели пропущены"],
        estimatedMinutes: ["Минут", "Минуты"],
        verificationCases: ["Тексеру мысалдары", "Проверочные примеры"],
        input: ["Берілгені", "Дано"],
        expected: ["Нәтиже", "Результат"],
        translation: ["Аударма", "Перевод"],
      };
      return /^\d+$/.test(key)
        ? String(Number(key) + 1)
        : names[key]
          ? say(names[key][0], names[key][1])
          : say("Қосымша мәліметтер", "Дополнительные сведения");
    }
    function finish(merged, keepDirty) {
      var state = comparison;
      comparison = null;
      if (unlock) {
        unlock();
        unlock = null;
      }
      base = copy(state.latest.draft);
      if (state.recovered) used = state.recovered;
      options.apply(state.latest, merged, keepDirty);
      if (!keepDirty) clean();
      else {
        stage = "pending";
        schedule();
      }
      render();
    }
    function loadComparison() {
      if (reading) reading.abort();
      var target = comparison;
      target.loading = true;
      target.error = "";
      target.choices = {};
      render();
      reading = options.request(
        (options.kind === "ktp" ? "ktp/" : "generations/") + options.id,
        "GET",
        undefined,
        function (err, value) {
          if (!active || comparison !== target) return;
          reading = null;
          target.loading = false;
          if (err) target.error = err;
          else target.latest = options.snapshot(value);
          render();
        }
      );
    }
    function compare(stored) {
      if (timer) clearTimeout(timer);
      if (!unlock) unlock = options.lock();
      comparison = {
        base: copy(stored ? stored.base : base),
        local: copy(stored ? stored.draft : options.get().draft),
        recovered: stored || null,
        choices: {},
        focus: true,
        trigger: document.activeElement,
        triggerKey: stored ? "restore-" + stored.id : "",
      };
      loadComparison();
    }
    function restore(row) {
      function begin() {
        if (!active) return;
        unlock = options.lock();
        restoring = true;
        render();
        reading = options.request(
          "drafts/" + row.id,
          "GET",
          undefined,
          function (err, stored) {
            if (!active) return;
            restoring = false;
            reading = null;
            if (err) {
              unlock();
              unlock = null;
              error = err;
              render();
              return;
            }
            if (
              stored.kind !== options.kind ||
              stored.resourceId !== options.id
            ) {
              unlock();
              unlock = null;
              return;
            }
            compare(stored);
          }
        );
      }
      if (options.dirty())
        options.confirm(
          say(
            "Осы қойындыдағы өзгерістер нобаймен ауыстырылсын ба?",
            "Заменить правки в этой вкладке резервным черновиком?"
          ),
          begin
        );
      else begin();
    }
    function renderComparison(parent) {
      var state = comparison,
        box = node("section", null, "panel draft-conflict", parent);
      box.setAttribute(
        "aria-label",
        say("Нұсқаларды салыстыру", "Сравнение версий")
      );
      var heading = node(
        "h2",
        say(
          "Материалдың жаңа нұсқасы бар",
          "Есть более новая версия материала"
        ),
        null,
        box
      );
      heading.tabIndex = -1;
      heading.setAttribute("data-draft-focus", "heading");
      node(
        "p",
        say(
          "Әртүрлі өрістердегі өзгерістер біріктіріледі. Өзгерген бір өріс үшін нұсқаны таңдаңыз.",
          "Изменения в разных полях объединятся. Для одного изменённого поля выберите нужный вариант."
        ),
        null,
        box
      );
      if (state.loading)
        node(
          "p",
          say("Сақталған нұсқа жүктелуде…", "Загружаем сохранённую версию…"),
          "muted",
          box
        );
      else if (state.error) {
        node("p", state.error, "notice", box).setAttribute("role", "alert");
        button(box, say("Қайталау", "Повторить сравнение"), loadComparison);
      } else if (state.latest) {
        var result = merge.mergeDrafts(
            state.base,
            state.local,
            state.latest.draft,
            state.choices
          ),
          remaining = 0;
        result.conflicts.forEach(function (conflict, index) {
          if (!state.choices[conflict.key]) remaining++;
          var group = node("fieldset", null, "draft-choice", box);
          node(
            "legend",
            conflict.path.map(label).join(" · ") || say("Материал", "Материал"),
            null,
            group
          );
          var pair = node("div", null, "draft-options", group);
          ["local", "remote"].forEach(function (choice) {
            var option = node("label", null, null, pair),
              line = node("span", null, null, option);
            var input = node("input", null, null, line),
              title =
                choice === "local"
                  ? say("Менің өзгерістерім", "Мои правки")
                  : say("Сақталған нұсқа", "Сохранённая версия");
            input.type = "radio";
            input.name = "draft-choice-" + index;
            input.value = choice;
            input.checked = state.choices[conflict.key] === choice;
            input.setAttribute(
              "data-draft-focus",
              "choice-" + index + "-" + choice
            );
            input.setAttribute("aria-label", title);
            line.appendChild(document.createTextNode(title));
            node("pre", readable(conflict[choice]), null, option).tabIndex = 0;
            input.onchange = function () {
              state.choices[conflict.key] = choice;
              render();
              var selected = host.querySelector(
                'input[name="draft-choice-' +
                  index +
                  '"][value="' +
                  choice +
                  '"]'
              );
              if (selected) selected.focus();
            };
          });
        });
        var keepDirty = !merge.draftsEqual(result.merged, state.latest.draft);
        node(
          "p",
          keepDirty
            ? say(
                "Нәтижені қолданып, тексеріп, «Сақтау» түймесін басыңыз.",
                "Примените результат, проверьте и нажмите «Сохранить»."
              )
            : say(
                "Нәтиже сақталған нұсқамен бірдей. Қайта сақтау қажет емес.",
                "Результат совпадает с сохранённой версией. Повторное сохранение не требуется."
              ),
          "muted",
          box
        );
        var actions = node("div", null, "actions", box);
        button(
          actions,
          keepDirty
            ? say("Біріктіруді қолдану", "Применить объединение")
            : say("Редакторды синхрондау", "Синхронизировать редактор"),
          function () {
            finish(result.merged, keepDirty);
          },
          true
        ).disabled = remaining > 0;
        button(
          actions,
          say("Сақталған нұсқаны пайдалану", "Использовать сохранённую версию"),
          function () {
            options.confirm(
              say(
                "Барлық өзгерістерден бас тартып, сақталған нұсқаны ашу керек пе?",
                "Отказаться от всех правок и открыть сохранённую версию?"
              ),
              function () {
                finish(state.latest.draft, false);
              }
            );
          }
        );
      }
      var cancel = button(
        box,
        say("Өңдеуді жалғастыру", "Продолжить редактирование"),
        function () {
          if (reading) reading.abort();
          comparison = null;
          if (unlock) unlock();
          unlock = null;
          render();
          schedule();
          var trigger = state.triggerKey
            ? host.querySelector(
                '[data-draft-focus="' + state.triggerKey + '"]'
              )
            : state.trigger;
          if (trigger && document.documentElement.contains(trigger))
            trigger.focus();
        }
      );
      cancel.setAttribute("data-draft-focus", "cancel");
    }
    function render() {
      if (!active || !host || !document.documentElement.contains(host)) return;
      var focused = host.contains(document.activeElement)
        ? document.activeElement.getAttribute("data-draft-focus")
        : null;
      host.textContent = "";
      if (restoring) {
        node(
          "p",
          say("Сақтық нобай жүктелуде…", "Загружаем резервный черновик…"),
          "muted",
          host
        ).setAttribute("role", "status");
        button(host, say("Бас тарту", "Отменить восстановление"), function () {
          if (reading) reading.abort();
          reading = null;
          restoring = false;
          if (unlock) unlock();
          unlock = null;
          render();
          schedule();
        });
        return;
      }
      if (comparison) {
        renderComparison(host);
        var focusKey = focused || (comparison.focus ? "heading" : "");
        var focusNode = focusKey
          ? host.querySelector('[data-draft-focus="' + focusKey + '"]')
          : null;
        if (focusNode) focusNode.focus();
        comparison.focus = false;
        return;
      }
      if (options.dirty()) {
        var status = node(
          "p",
          stage === "saved"
            ? say(
                "Сақтық нобай аккаунтта сақталды",
                "Резервный черновик сохранён в аккаунте"
              )
            : stage === "error"
              ? say(
                  "Сақтық нобай жаңартылмады. Қойындыны жаппаңыз.",
                  "Резервный черновик не обновлён. Не закрывайте вкладку."
                )
              : say(
                  "Сақтық көшірме жаңартылуда…",
                  "Резервная копия обновляется…"
                ),
          "muted",
          host
        );
        status.setAttribute("role", "status");
        if (stage === "error")
          button(host, say("Қайталау", "Повторить"), function () {
            stage = "pending";
            saveNow();
          });
      }
      if (error) {
        node("p", error, "notice", host).setAttribute("role", "alert");
        button(host, say("Тізімді жаңарту", "Обновить список"), refresh);
      }
      if (!copies.length) return;
      var details = node("details", null, "panel", host);
      details.open = true;
      node(
        "summary",
        say("Сақтық нобайлар", "Резервные черновики") + " · " + copies.length,
        null,
        details
      );
      node(
        "p",
        say(
          "Көшірмелер аккаунтыңызда 7 күн қолжетімді. Қалпына келтіру нұсқаларды салыстыруды ашады.",
          "Копии доступны в вашем аккаунте 7 дней. Восстановление откроет сравнение версий."
        ),
        "muted",
        details
      );
      copies.forEach(function (row) {
        var actions = node("div", null, "actions draft-row", details);
        node("span", time(row.savedAt), null, actions);
        var restoreButton = button(
          actions,
          say("Нобайды қалпына келтіру", "Восстановить черновик"),
          function () {
            restore(row);
          }
        );
        restoreButton.setAttribute("data-draft-focus", "restore-" + row.id);
        button(actions, say("Көшірмені жою", "Удалить копию"), function () {
          options.confirm(
            say(
              "Сақтық көшірме жойылсын ба? Материал өзгермейді.",
              "Удалить резервную копию? Материал останется без изменений."
            ),
            function () {
              discard(row.id, row.sequence, function (err) {
                if (!active) return;
                if (err) {
                  error = err;
                  render();
                } else refresh();
              });
            }
          );
        });
      });
    }
    return {
      mount: function (container) {
        host = container;
        render();
        if (!loaded && !listing) refresh();
      },
      baseline: function (snapshot) {
        base = copy(snapshot.draft);
        if (loaded) refresh();
      },
      changed: function () {
        stage = "pending";
        render();
        schedule();
      },
      resume: function () {
        render();
        schedule();
      },
      accepted: function () {
        base = copy(options.get().draft);
        clean();
        render();
      },
      compare: function () {
        if (!comparison) compare();
      },
      stop: function () {
        active = false;
        if (timer) clearTimeout(timer);
        if (listing) listing.abort();
        if (reading) reading.abort();
        if (unlock) unlock();
        host = null;
      },
    };
  };
})(window);
