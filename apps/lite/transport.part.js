  function request(path, method, data, done) {
    var xhr = new XMLHttpRequest();
    xhr.open(method || "GET", "/api/" + path);
    if (!account.track(xhr, path)) return xhr;
    xhr.timeout = 120000;
    var form = data instanceof FormData;
    if (!form && data !== undefined)
      xhr.setRequestHeader("Content-Type", "application/json");
    var signature = "";
    if (method && method !== "GET") {
      var costly =
        method === "POST" &&
        (path === "generations" ||
          path === "exports" ||
          /^generations\/[^/]+\/tasks\/[^/]+\/regenerate$/.test(path));
      if (costly) {
        signature = path + ":" + JSON.stringify(data);
        if (!requestKeys[signature]) requestKeys[signature] = uuid();
      }
      xhr.setRequestHeader(
        "Idempotency-Key",
        signature ? requestKeys[signature] : uuid()
      );
    }
    xhr.onload = function () {
      if (!account.finish(xhr)) return;
      var result;
      try {
        result = JSON.parse(xhr.responseText);
      } catch (parseError) {
        void parseError;
        done(
          t(
            xhr.status === 429
              ? "LIMIT"
              : xhr.status === 413
                ? "FILE_SIZE"
                : "error"
          )
        );
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        var code = result.code || (result.error && result.error.code);
        if (account.reject(path, xhr.status, code)) return;
        if (xhr.status === 429 && code !== "READ_LIMIT") code = "LIMIT";
        var reason = words[code] ? t(code) : t("error");
        if (
          code === "READ_LIMIT" &&
          typeof result.retryAfter === "number" &&
          Math.floor(result.retryAfter) === result.retryAfter &&
          result.retryAfter > 0 &&
          result.retryAfter <= 600
        )
          reason +=
            locale === "ru"
              ? " Повторите через " + result.retryAfter + " с."
              : " " + result.retryAfter + " секундтан кейін қайталаңыз.";
        done(reason, result, xhr.status);
        return;
      }
      if (signature) delete requestKeys[signature];
      done(null, result);
    };
    xhr.onerror = xhr.ontimeout = function () {
      if (!account.finish(xhr)) return;
      done(t("error"));
    };
    xhr.onabort = function () {
      account.finish(xhr);
    };
    xhr.send(data === undefined ? null : form ? data : JSON.stringify(data));
    return xhr;
  }
  function lockControls() {
    var controls = document.querySelectorAll("button,input,textarea,select"),
      states = [];
    for (var i = 0; i < controls.length; i++) {
      if (controls[i].getAttribute("data-allow-busy") === "true") continue;
      states.push({ node: controls[i], disabled: controls[i].disabled });
      controls[i].disabled = true;
    }
    return function () {
      for (var j = 0; j < states.length; j++)
        if (document.documentElement.contains(states[j].node))
          states[j].node.disabled = states[j].disabled;
    };
  }
  function action(path, data, done, method) {
    if (busy) return;
    busy = true;
    var unlock = lockControls();
    note(t("loading"));
    return request(
      path,
      method || "POST",
      data,
      function (err, result, status) {
        busy = false;
        unlock();
        if (err) {
          if (
            status === 409 &&
            draftSession &&
            dirty &&
            (/^ktp\/[^/]+\/(rows|confirm)$/.test(path) ||
              /^generations\/[^/]+\/(document|tasks\/[^/]+)$/.test(path))
          ) {
            note("");
            draftSession.compare();
            return;
          }
          note(err, true);
          if (draftSession) draftSession.resume();
          return;
        }
        note("");
        done(result);
        if (draftSession) draftSession.resume();
      }
    );
  }
  function field(parent, title, value, type, change) {
    var label = add(parent, el("label", title));
    var input = add(label, el(type === "textarea" ? "textarea" : "input"));
    if (type !== "textarea") input.type = type || "text";
    input.setAttribute("aria-label", title);
    input.value = value === null || value === undefined ? "" : value;
    input.oninput = function () {
      if (change) change(input.value);
    };
    return input;
  }
  function select(parent, title, options, value, change) {
    var label = add(parent, el("label", title)),
      s = add(label, el("select"));
    s.setAttribute("aria-label", title);
    options.forEach(function (o) {
      var n = el("option", o[1]);
      n.value = o[0];
      s.appendChild(n);
    });
    s.value = value;
    if (change)
      s.onchange = function () {
        change(s.value);
      };
    return s;
  }
  function clear(title, kind) {
    if (!kind && draftSession) {
      draftSession.stop();
      draftSession = null;
      draftIdentity = "";
      activeTask = null;
      wholeDocumentDirty = false;
    }
    invalidateReads();
    content.textContent = "";
    add(content, el("h1", title));
  }
  function confirmAction(value, done, destructive) {
    var dialog = el("dialog", null, "confirm-dialog");
    if (typeof dialog.showModal !== "function") {
      if (window.confirm(value) && account.active()) done();
      return;
    }
    var trigger = document.activeElement;
    add(
      dialog,
      el("h2", text("Әрекетті растаңыз", "Подтвердите действие"))
    ).id = "lite-confirm-title";
    add(dialog, el("p", value)).id = "lite-confirm-description";
    dialog.setAttribute("aria-labelledby", "lite-confirm-title");
    dialog.setAttribute("aria-describedby", "lite-confirm-description");
    var actions = add(dialog, el("div", null, "actions"));
    function close(accepted) {
      dialog.close();
      dialog.parentNode.removeChild(dialog);
      if (trigger && document.documentElement.contains(trigger))
        trigger.focus();
      if (accepted && account.active()) done();
    }
    var cancel = add(
      actions,
      button(text("Бас тарту", "Отмена"), function () {
        close(false);
      })
    );
    add(
      actions,
      button(
        destructive ? t("remove") : text("Жалғастыру", "Продолжить"),
        function () {
          close(true);
        },
        true
      )
    );
    dialog.oncancel = function (event) {
      event.preventDefault();
      close(false);
    };
    document.body.appendChild(dialog);
    dialog.showModal();
    cancel.focus();
  }
  function leave(done) {
    if (!dirty) done();
    else confirmAction(t("dirty"), done);
  }
  function go(view) {
    leave(function () {
      dirty = false;
      currentView = view;
      plan = null;
      generation = null;
      rowPage = 0;
      classFilter = "";
      listOffset = 0;
      note("");
      renderNav();
      render();
    });
  }
