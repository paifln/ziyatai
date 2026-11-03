/* Account lifetime for school browsers. No storage, timers or framework. */
(function (root) {
  "use strict";
  root.ZiyatLiteAccount = function (options) {
    var owner = null,
      stopped = false,
      checking = false,
      pending = [];
    function changed() {
      if (stopped) return;
      stopped = true;
      var requests = pending;
      pending = [];
      // Suppress callbacks before aborting; abort handlers may run immediately.
      for (var i = 0; i < requests.length; i++) requests[i].abort();
      options.changed();
    }
    return {
      bind: function (id) {
        if (owner !== null && owner !== id) changed();
        else if (!stopped) owner = id;
      },
      active: function () {
        return !stopped;
      },
      track: function (xhr, path) {
        if (stopped) return false;
        pending.push(xhr);
        if (
          owner &&
          path &&
          (path.indexOf("auth/") !== 0 ||
            /^(auth\/sign-out|auth\/change-password|auth\/revoke-other-sessions)$/.test(
              path
            )) &&
          path !== "public-config"
        )
          xhr.setRequestHeader("X-ZiyatAI-Account", owner);
        return true;
      },
      finish: function (xhr) {
        var i = pending.indexOf(xhr);
        if (i !== -1) pending.splice(i, 1);
        return !stopped;
      },
      reject: function (path, status, code) {
        if (
          owner &&
          (code === "SESSION_CHANGED" ||
            (status === 401 && path.indexOf("auth/") !== 0))
        ) {
          changed();
          return true;
        }
        return stopped;
      },
      verify: function () {
        if (!owner || stopped || checking) return;
        checking = true;
        options.request(
          "auth/get-session",
          "GET",
          undefined,
          function (err, session) {
            checking = false;
            // Network/rate-limit failures are not evidence of sign-out.
            if (err || stopped) return;
            if (!session || !session.user || session.user.id !== owner)
              changed();
          }
        );
      },
    };
  };
})(window);
