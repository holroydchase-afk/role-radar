/* Role Radar: built from src/recruiter-store.ts by scripts/build.mjs. Edit the source, not this file. */
"use strict";
var RoleRadarRecruiters = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/recruiter-store.ts
  var recruiter_store_exports = {};
  __export(recruiter_store_exports, {
    PATH: () => PATH,
    RULES: () => RULES,
    create: () => create
  });
  var PATH = "recruiters";
  var RULES = [{ path: PATH, read: "owner", write: "owner" }];
  function create({ db = null, user = null, publicView = false } = {}) {
    let mode = "pending";
    const store = {
      get mode() {
        return mode;
      },
      get visible() {
        return mode === "owner" || mode === "unknown";
      },
      get canWrite() {
        return mode === "owner" || mode === "unknown";
      },
      async init() {
        if (publicView || !db) return mode = "off";
        if (!user || typeof user.isOwner !== "function") return mode = "unknown";
        try {
          const own = await user.isOwner();
          mode = own === true ? "owner" : own === false ? "viewer" : "unknown";
        } catch (_) {
          mode = "unknown";
        }
        return mode;
      },
      /** Calls cb(list) now and on every change. Viewers and the public demo get [] once. */
      subscribe(cb, onError) {
        if (!store.visible) {
          cb([]);
          return () => {
          };
        }
        return db.collection(PATH).onSnapshot((s) => cb(s.docs.map((d) => ({ ...d.data(), _id: d.id }))), onError || (() => {
        }));
      },
      async add(key, doc) {
        guard();
        return db.doc(PATH + "/" + key).set(doc);
      },
      async update(key, patch) {
        guard();
        return db.doc(PATH + "/" + key).update(patch);
      }
    };
    function guard() {
      if (!store.canWrite) throw new Error("Only the page's owner can change recruiters.");
    }
    return store;
  }
  return __toCommonJS(recruiter_store_exports);
})();
globalThis.RoleRadarRecruiters = RoleRadarRecruiters;
