  function render() {
    if (plan) {
      renderPlan();
      return;
    }
    if (generation) {
      renderGeneration();
      return;
    }
    if (currentView === "upload") {
      uploadForm();
      return;
    }
    clear(t(currentView));
    var actions = add(content, el("div", null, "actions"));
    add(actions, button(t("refresh"), render));
    if (currentView === "history" && profile && profile.capabilities.demo)
      add(
        actions,
        button(t("demo"), function () {
          action("demo", { locale: locale }, function (g) {
            openGeneration(g.id);
          });
        })
      );
    var resource =
      currentView === "plans"
        ? "ktp"
        : currentView === "history"
          ? "history"
          : "library";
    var searchForm = add(content, el("form", null, "panel"));
    searchForm.setAttribute("role", "search");
    var query = field(
      searchForm,
      text("Атауы бойынша іздеу", "Найти по названию"),
      listQueries[resource],
      "search"
    );
    query.maxLength = 200;
    var status = null;
    if (resource === "ktp")
      status = select(
        searchForm,
        text("КТЖ күйі", "Статус КТП"),
        [
          ["", text("Барлық күйлер", "Все статусы")],
          ["confirmed", t("confirmed")],
          ["review", t("review")],
          ["extracting", t("extracting")],
          ["failed", t("failed")],
          ["cancelled", t("cancelled")],
        ],
        listStatus
      );
    var searchActions = add(searchForm, el("div", null, "actions"));
    var find = add(
      searchActions,
      button(text("Іздеу", "Найти"), function () {})
    );
    find.type = "submit";
    searchForm.onsubmit = function (event) {
      event.preventDefault();
      listQueries[resource] = query.value.trim();
      if (status) listStatus = status.value;
      listOffset = 0;
      render();
      content.querySelector('input[type="search"]').focus();
    };
    if (listQueries[resource] || (resource === "ktp" && listStatus))
      add(
        searchActions,
        button(text("Сүзгілерді тазарту", "Сбросить фильтры"), function () {
          listQueries[resource] = "";
          if (resource === "ktp") listStatus = "";
          listOffset = 0;
          render();
          content.querySelector('input[type="search"]').focus();
        })
      );
    var panel = add(content, el("section", t("loading"), "panel"));
    panel.setAttribute("aria-busy", "true");
    var version = viewVersion;
    pageRead = request(
      resource +
        "?limit=21&offset=" +
        listOffset +
        "&q=" +
        encodeURIComponent(listQueries[resource]) +
        (resource === "ktp" && listStatus
          ? "&status=" + encodeURIComponent(listStatus)
          : ""),
      "GET",
      undefined,
      function (err, items) {
        if (version !== viewVersion) return;
        pageRead = null;
        panel.setAttribute("aria-busy", "false");
        if (err) {
          panel.textContent = "";
          add(panel, el("p", err, "notice error"));
          add(panel, button(text("Қайталау", "Повторить"), render));
          return;
        }
        panel.textContent = "";
        var hasNext = items.length > 20;
        items = items.slice(0, 20);
        var summary = add(panel, el("p", "", "muted"));
        summary.setAttribute("role", "status");
        summary.textContent = !items.length
          ? listQueries[resource] || (resource === "ktp" && listStatus)
            ? text(
                "Ештеңе табылмады. Атауды немесе сүзгіні өзгертіңіз.",
                "Ничего не найдено. Измените название или фильтр."
              )
            : t("empty")
          : text("Материалдар: ", "Материалы: ") +
            (listOffset + 1) +
            "–" +
            (listOffset + items.length);
        items.forEach(function (item) {
          var row = add(panel, el("div", null, "resource")),
            label = add(row, el("div"));
          add(label, el("strong", item.title));
          add(
            label,
            el(
              "small",
              t(item.status) +
                (item.format
                  ? " · " +
                    item.format.toUpperCase() +
                    " · " +
                    (item.teacher_reviewed
                      ? text("Мұғалім тексерді", "Проверено учителем")
                      : text("Жоба", "Черновик"))
                  : "")
            )
          );
          if (resource === "library") {
            if (item.status === "succeeded" && item.teacher_reviewed)
              add(
                row,
                link(
                  t("download"),
                  "/api/exports/" + encodeURIComponent(item.id) + "/download"
                )
              );
            if (!item.teacher_reviewed)
              add(
                row,
                button(
                  text("Тапсырмаларды тексеру", "Проверить задания"),
                  function () {
                    openGeneration(item.generation_id);
                  }
                )
              );
          } else
            add(
              row,
              button(t("open"), function () {
                if (resource === "ktp") openPlan(item.id);
                else openGeneration(item.id);
              })
            );
          add(
            row,
            button(t("remove"), function () {
              confirmAction(
                t("deleteConfirm"),
                function () {
                  action(
                    (resource === "ktp"
                      ? "ktp"
                      : resource === "history"
                        ? "generations"
                        : "exports") +
                      "/" +
                      item.id,
                    {},
                    render,
                    "DELETE"
                  );
                },
                true
              );
            })
          );
        });
        var pages = add(content, el("nav", null, "pagination"));
        pages.setAttribute(
          "aria-label",
          text("Материалдар тізімінің беттері", "Страницы списка материалов")
        );
        if (listOffset > 0)
          add(
            pages,
            button(t("prev"), function () {
              listOffset = Math.max(0, listOffset - 20);
              render();
            })
          );
        if (hasNext)
          add(
            pages,
            button(t("next"), function () {
              listOffset += 20;
              render();
            })
          );
      }
    );
  }
