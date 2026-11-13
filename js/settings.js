"use strict";

const Settings = (() => {
  const state = { tab: "account" };

  function open() {
    const me = Store.currentUser();
    if (!me) return;
    const tabs = [
      ["account", "My Account"],
      ["appearance", "Appearance"],
      ["danger", "Danger Zone"]
    ];
    const m = UI.openModal(`
      <div class="modal-header"><h2>User Settings</h2><button class="icon-btn" data-close>✕</button></div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        ${tabs.map(([key, label]) => `<button class="btn ${state.tab === key ? "btn-primary" : "btn-ghost"} btn-small" data-settings-tab="${key}">${label}</button>`).join("")}
      </div>
      <div data-settings-body>${bodyHTML(me)}</div>`, { wide: true });
    m.el.querySelector("[data-close]").onclick = m.close;
    bind(m);
  }

  function bodyHTML(me) {
    if (state.tab === "appearance") return appearanceHTML();
    if (state.tab === "danger") return dangerHTML();
    return accountHTML(me);
  }

  function accountHTML(me) {
    const avatar = me.avatar || {};
    const status = me.status || "online";
    const avatarType = avatar.type || "initials";
    const accent = Store.db.settings.accent || "#5865f2";
    return `
      <div class="section-title">Profile</div>
      <div class="form-row">
        <div class="field"><label>Display Name</label><input id="set-display" maxlength="64" value="${Utils.esc(me.displayName || "")}"></div>
        <div class="field"><label>Username</label><input id="set-username" maxlength="32" value="${Utils.esc(me.username)}"></div>
      </div>
      <div class="field"><label>Avatar</label>
        <select id="set-avatar-type">
          <option value="initials" ${avatarType === "initials" ? "selected" : ""}>Initials</option>
          <option value="emoji" ${avatarType === "emoji" ? "selected" : ""}>Emoji</option>
          <option value="color" ${avatarType === "color" ? "selected" : ""}>Color</option>
        </select>
        <div id="set-avatar-extra" style="margin-top:8px">
          ${avatarType === "emoji" ? `<input id="set-avatar-emoji" maxlength="8" value="${Utils.esc(avatar.value || "")}" placeholder="😀">` : ""}
          ${avatarType === "color" ? `<div class="avatar-picker">${Utils.COLORS.map(c => `<div class="color-option ${avatar.value === c ? "selected" : ""}" data-color="${c}" style="background:${c}"></div>`).join("")}</div>` : ""}
          ${avatarType === "initials" ? `<div class="hint">Using initials: ${Utils.esc(avatar.value || Utils.initials(me.displayName || me.username))}</div>` : ""}
        </div>
      </div>
      <div class="field"><label>Bio</label><textarea id="set-bio" maxlength="300" rows="3" placeholder="Tell us a little about yourself">${Utils.esc(me.bio || "")}</textarea></div>
      <div class="field"><label>Status</label>
        <select id="set-status">
          <option value="online" ${status === "online" ? "selected" : ""}>Online</option>
          <option value="idle" ${status === "idle" ? "selected" : ""}>Idle</option>
          <option value="dnd" ${status === "dnd" ? "selected" : ""}>Do Not Disturb</option>
          <option value="invisible" ${status === "invisible" ? "selected" : ""}>Invisible</option>
        </select>
      </div>
      <div class="modal-footer"><button class="btn btn-primary" id="set-save">Save Changes</button></div>

      <div class="section-title">Password</div>
      <div class="form-row">
        <div class="field"><label>Current Password</label><input id="set-old-pw" type="password"></div>
        <div class="field"><label>New Password</label><input id="set-new-pw" type="password"></div>
      </div>
      <div class="modal-footer"><button class="btn btn-outline" id="set-change-pw">Change Password</button></div>

      <div class="section-title">Cloud Sync</div>
      <div class="field"><label>Worker URL</label><input id="set-worker" placeholder="https://discord-kv.you.workers.dev"></div>
      <p class="hint">Paste your deployed Cloudflare Worker URL to sync all data through KV. Leave empty for local-only.</p>
      <div class="modal-footer"><button class="btn btn-outline" id="set-sync-save">Save Sync Settings</button></div>`;
  }

  function appearanceHTML() {
    const s = Store.db.settings;
    const theme = s.theme === "light" ? "light" : "dark";
    const accent = s.accent || "#5865f2";
    const accents = ["#5865f2", "#eb459e", "#ed4245", "#f26522", "#f0b232", "#57f287", "#1abc9c", "#3498db", "#9b59b6", "#e91e63"];
    return `
      <div class="section-title">Theme</div>
      <div class="setting-row">
        <div><div class="setting-label">Color Mode</div><div class="setting-desc">Choose light or dark theme.</div></div>
        <select id="set-theme" style="background:var(--bg-tertiary);border:1px solid var(--border-subtle);border-radius:4px;padding:8px 12px">
          <option value="dark" ${theme === "dark" ? "selected" : ""}>Dark</option>
          <option value="light" ${theme === "light" ? "selected" : ""}>Light</option>
        </select>
      </div>
      <div class="section-title">Accent Color</div>
      <div class="avatar-picker">
        ${accents.map(c => `<div class="color-option ${accent === c ? "selected" : ""}" data-accent="${c}" style="background:${c}"></div>`).join("")}
      </div>
      <div class="modal-footer"><button class="btn btn-primary" id="set-appearance-save">Save</button></div>`;
  }

  function dangerHTML() {
    return `
      <div class="section-title">Log Out</div>
      <p style="color:var(--text-muted)">Log out of this account on this device.</p>
      <div class="modal-footer"><button class="btn btn-danger" id="set-logout">Log Out</button></div>
      <div class="section-title">Reset Everything</div>
      <p style="color:var(--text-muted)">This deletes all local accounts, servers, messages, and friends. This cannot be undone.</p>
      <div class="modal-footer"><button class="btn btn-danger" id="set-reset">Reset All Data</button></div>`;
  }

  function bind(m) {
    const me = Store.currentUser();
    if (!me) return;
    m.el.querySelectorAll("[data-settings-tab]").forEach(btn => {
      btn.onclick = () => { state.tab = btn.dataset.settingsTab; m.el.querySelector("[data-settings-body]").innerHTML = bodyHTML(me); bind(m); };
    });

    if (state.tab === "account") {
      const typeSelect = m.el.querySelector("#set-avatar-type");
      typeSelect.onchange = () => {
        const body = m.el.querySelector("[data-settings-body]");
        body.innerHTML = accountHTML(Store.currentUser());
        bind(m);
      };
      m.el.querySelector("#set-save").onclick = () => {
        try {
          const type = m.el.querySelector("#set-avatar-type").value;
          let avatar = { type: "initials", value: Utils.initials(m.el.querySelector("#set-display").value || me.username) };
          if (type === "emoji") avatar = { type: "emoji", value: (m.el.querySelector("#set-avatar-emoji") || {}).value || "😀" };
          if (type === "color") {
            const sel = m.el.querySelector(".color-option.selected");
            avatar = { type: "color", value: sel ? sel.dataset.color : Utils.COLORS[0] };
          }
          Store.updateProfile(me.id, {
            displayName: m.el.querySelector("#set-display").value,
            username: m.el.querySelector("#set-username").value,
            avatar,
            bio: m.el.querySelector("#set-bio").value,
            status: m.el.querySelector("#set-status").value
          });
          UI.toast("Profile updated");
          m.close();
          App.render();
        } catch (e) { UI.toast(e.message, "error"); }
      };
      m.el.querySelectorAll(".color-option").forEach(c => {
        c.onclick = () => {
          m.el.querySelectorAll(".color-option").forEach(x => x.classList.remove("selected"));
          c.classList.add("selected");
        };
      });
      m.el.querySelector("#set-change-pw").onclick = () => {
        const oldPw = m.el.querySelector("#set-old-pw").value;
        const newPw = m.el.querySelector("#set-new-pw").value;
        Store.changePassword(me.id, oldPw, newPw).then(() => {
          UI.toast("Password changed");
          m.el.querySelector("#set-old-pw").value = "";
          m.el.querySelector("#set-new-pw").value = "";
        }).catch(e => UI.toast(e.message, "error"));
      };
      const workerInput = m.el.querySelector("#set-worker");
      if (workerInput) {
        workerInput.value = (typeof Cloud !== "undefined" && Cloud.workerUrl()) || "";
        m.el.querySelector("#set-sync-save").onclick = async () => {
          Cloud.setWorkerUrl(workerInput.value);
          if (Cloud.enabled()) {
            UI.toast("Syncing from cloud…");
            const adopted = await Cloud.pull();
            UI.toast(adopted ? "Loaded cloud data" : "No cloud data yet — local data will be pushed");
            Cloud.push();
          } else {
            UI.toast("Cloud sync disabled — staying local");
          }
          App.render();
        };
      }
    } else if (state.tab === "appearance") {
      m.el.querySelectorAll("[data-accent]").forEach(c => {
        c.onclick = () => {
          m.el.querySelectorAll("[data-accent]").forEach(x => x.classList.remove("selected"));
          c.classList.add("selected");
        };
      });
      m.el.querySelector("#set-appearance-save").onclick = () => {
        const sel = m.el.querySelector("[data-accent].selected");
        Store.updateSettings({
          theme: m.el.querySelector("#set-theme").value,
          accent: sel ? sel.dataset.accent : Store.db.settings.accent
        });
        UI.toast("Appearance updated");
        m.close();
        App.render();
      };
    } else if (state.tab === "danger") {
      m.el.querySelector("#set-logout").onclick = () => { m.close(); Store.logout(); App.render(); };
      m.el.querySelector("#set-reset").onclick = () => {
        UI.confirmDialog({
          title: "Reset All Data",
          message: "This will delete everything. Are you absolutely sure?",
          confirmText: "Reset Everything",
          danger: true,
          onConfirm: () => Store.resetAll()
        });
      };
    }
  }

  return { open };
})();
