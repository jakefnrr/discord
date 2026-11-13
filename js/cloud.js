"use strict";

/* Cloud sync via a Cloudflare Worker backed by KV.
   WORKER_URL is configured in Settings -> Cloud Sync (stored in localStorage).
   Everything keeps working local-only when no URL is set. */
window.CLOUD_CONFIG = { WORKER_URL: "" };

const Cloud = (() => {
  const LS_KEY = "discordCloudConfig";
  const KV_KEY = "discord-db";
  let timer = null;
  let pulling = false;

  function cfg() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return window.CLOUD_CONFIG || {};
  }

  function workerUrl() {
    return String(cfg().WORKER_URL || "").trim().replace(/\/+$/, "");
  }

  function enabled() { return !!workerUrl(); }

  function setWorkerUrl(u) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ WORKER_URL: String(u || "").trim() })); } catch (e) {}
  }

  async function pull() {
    if (!enabled() || pulling || typeof Store === "undefined" || !Store.db) return false;
    pulling = true;
    try {
      const r = await fetch(workerUrl() + "/kv/" + KV_KEY);
      if (!r.ok) return false;
      const data = await r.json();
      if (data && data !== null) return !!Store.loadRemote(data);
      return false;
    } catch (e) {
      return false;
    } finally {
      pulling = false;
    }
  }

  function push() {
    if (!enabled() || typeof Store === "undefined" || !Store.db) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        await fetch(workerUrl() + "/kv/" + KV_KEY, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Store.db)
        });
      } catch (e) {}
    }, 1200);
  }

  return { init() { pull(); }, push, pull, enabled, setWorkerUrl, workerUrl };
})();
