/* Generated from packages/domain/merge-drafts.ts by npm run build:lite. */
(function (root) {
  "use strict";
  var exports = {};
  var __spreadArray =
    (this && this.__spreadArray) ||
    function (to, from, pack) {
      if (pack || arguments.length === 2)
        for (var i = 0, l = from.length, ar; i < l; i++) {
          if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
          }
        }
      return to.concat(ar || Array.prototype.slice.call(from));
    };
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.draftsEqual = draftsEqual;
  exports.mergeDrafts = mergeDrafts;
  var absent = Object.create(null);
  var has = function (value, key) {
    return Object.prototype.hasOwnProperty.call(value, key);
  };
  function object(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  function draftsEqual(a, b) {
    if (a === b || (a !== a && b !== b)) return true;
    if (a === absent || b === absent) return false;
    if (Array.isArray(a) && Array.isArray(b))
      return (
        a.length === b.length &&
        a.every(function (v, i) {
          return draftsEqual(v, b[i]);
        })
      );
    if (object(a) && object(b)) {
      var keys = Object.keys(a);
      return (
        keys.length === Object.keys(b).length &&
        keys.every(function (key) {
          return has(b, key) && draftsEqual(a[key], b[key]);
        })
      );
    }
    return false;
  }
  function mergeDrafts(base, local, remote, choices) {
    if (choices === void 0) {
      choices = {};
    }
    var conflicts = [];
    function merge(b, l, r, path) {
      if (draftsEqual(l, r)) return l;
      if (draftsEqual(b, l)) return r;
      if (draftsEqual(b, r)) return l;
      if (object(b) && object(l) && object(r)) {
        var seen_1 = Object.create(null),
          keys_1 = [];
        [b, l, r].forEach(function (value) {
          return Object.keys(value).forEach(function (key) {
            if (!has(seen_1, key)) {
              seen_1[key] = true;
              keys_1.push(key);
            }
          });
        });
        var result_1 = {};
        keys_1.forEach(function (key) {
          var value = merge(
            has(b, key) ? b[key] : absent,
            has(l, key) ? l[key] : absent,
            has(r, key) ? r[key] : absent,
            __spreadArray(__spreadArray([], path, true), [key], false)
          );
          if (value !== absent)
            Object.defineProperty(result_1, key, {
              value: value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
        });
        return result_1;
      }
      if (Array.isArray(b) && Array.isArray(l) && Array.isArray(r)) {
        var ids = function (items) {
          return items.map(function (item) {
            return object(item) && typeof item.id === "string" ? item.id : null;
          });
        };
        var bi = ids(b),
          li = ids(l),
          ri = ids(r);
        var unique_1 = Object.create(null);
        var validIds = bi.every(function (id) {
          if (id === null || has(unique_1, id)) return false;
          unique_1[id] = true;
          return true;
        });
        if (validIds && draftsEqual(bi, li) && draftsEqual(bi, ri))
          return b.map(function (value, i) {
            return merge(
              value,
              l[i],
              r[i],
              __spreadArray(__spreadArray([], path, true), [String(i)], false)
            );
          });
      }
      var key = JSON.stringify(path);
      conflicts.push({
        key: key,
        path: path,
        local: l === absent ? undefined : l,
        remote: r === absent ? undefined : r,
      });
      return choices[key] === "remote" ? r : l;
    }
    return { merged: merge(base, local, remote, []), conflicts: conflicts };
  }

  root.ZiyatDraftMerge = exports;
})(window);
