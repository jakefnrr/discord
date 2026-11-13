"use strict";

const UI = (() => {
  const modalRoot = () => document.getElementById("modal-root");
  const menuRoot = () => document.getElementById("menu-root");
  const toastRoot = () => {
    let root = document.querySelector(".toast-root");
    if (!root) {
      root = document.createElement("div");
      root.className = "toast-root";
      document.body.appendChild(root);
    }
    return root;
  };

  function toast(message, type = "") {
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.textContent = message;
    toastRoot().appendChild(el);
    setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; }, 2600);
    setTimeout(() => el.remove(), 3000);
  }

  function openModal(html, opts = {}) {
    closeMenus();
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<div class="modal ${opts.wide ? "wide" : ""}">${html}</div>`;
    const closeSelf = () => {
      document.removeEventListener("keydown", onKey, true);
      backdrop.remove();
    };
    backdrop.addEventListener("mousedown", e => {
      if (e.target === backdrop) closeSelf();
    });
    const onKey = e => {
      if (e.key !== "Escape") return;
      const all = modalRoot().querySelectorAll(".modal-backdrop");
      if (all.length && all[all.length - 1] === backdrop) closeSelf();
    };
    document.addEventListener("keydown", onKey, true);
    backdrop._onKey = onKey;
    modalRoot().appendChild(backdrop);
    return {
      el: backdrop.querySelector(".modal"),
      backdrop,
      close: closeSelf
    };
  }

  function closeModal() {
    const root = modalRoot();
    if (!root) return;
    const backdrops = root.querySelectorAll(".modal-backdrop");
    backdrops.forEach(b => {
      if (b._onKey) document.removeEventListener("keydown", b._onKey);
      b.remove();
    });
  }

  function confirmDialog({ title = "Are you sure?", message = "", confirmText = "Confirm", danger = false, onConfirm }) {
    const m = openModal(`
      <h2>${Utils.esc(title)}</h2>
      <p class="modal-sub">${Utils.esc(message)}</p>
      <div class="modal-footer">
        <button class="btn btn-ghost" data-action="cancel">Cancel</button>
        <button class="btn ${danger ? "btn-danger" : "btn-primary"}" data-action="confirm">${Utils.esc(confirmText)}</button>
      </div>
    `);
    m.el.querySelector('[data-action="cancel"]').onclick = m.close;
    m.el.querySelector('[data-action="confirm"]').onclick = () => { m.close(); onConfirm && onConfirm(); };
    return m;
  }

  let activeMenuCleanup = null;

  function contextMenu(x, y, items) {
    closeMenus();
    const menu = document.createElement("div");
    menu.className = "context-menu";
    for (const item of items) {
      if (item.sep) {
        const sep = document.createElement("div");
        sep.className = "menu-separator";
        menu.appendChild(sep);
        continue;
      }
      if (item.label && item.header) {
        const label = document.createElement("div");
        label.className = "menu-label";
        label.textContent = item.label;
        menu.appendChild(label);
        continue;
      }
      const btn = document.createElement("button");
      btn.className = "menu-item" + (item.danger ? " danger" : "");
      btn.innerHTML = `<span class="menu-icon">${item.icon || ""}</span><span>${Utils.esc(item.label)}</span>`;
      btn.onclick = () => { closeMenus(); item.fn && item.fn(); };
      menu.appendChild(btn);
    }
    menuRoot().appendChild(menu);
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.left = Math.min(x, vw - rect.width - 8) + "px";
    menu.style.top = Math.min(y, vh - rect.height - 8) + "px";

    function outside(e) { if (!menu.contains(e.target)) closeMenus(); }
    function escClose(e) { if (e.key === "Escape") closeMenus(); }
    function cleanup() {
      document.removeEventListener("mousedown", outside, true);
      document.removeEventListener("keydown", escClose, true);
      window.removeEventListener("blur", closeMenus);
      activeMenuCleanup = null;
    }
    setTimeout(() => {
      if (!menu.isConnected) return;
      document.addEventListener("mousedown", outside, true);
      document.addEventListener("keydown", escClose, true);
      window.addEventListener("blur", closeMenus);
      activeMenuCleanup = cleanup;
    }, 0);
    menu._cleanup = cleanup;
    return menu;
  }

  function closeMenus() {
    const root = menuRoot();
    if (root) root.innerHTML = "";
    if (activeMenuCleanup) { const c = activeMenuCleanup; activeMenuCleanup = null; c(); }
  }

  function copyText(text) {
    const done = () => toast("Copied to clipboard");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback());
    } else fallback();
    function fallback() {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast("Copy failed", "error"); }
      ta.remove();
    }
  }

  function statusLabel(status) {
    return { online: "Online", idle: "Idle", dnd: "Do Not Disturb", invisible: "Invisible", offline: "Offline" }[status] || status;
  }

  function profileHTML(user, opts = {}) {
    const me = Store.currentUser();
    const status = Store.effectiveStatus(user.id);
    const avatar = user.avatar || {};
    const avatarInner = avatar.type === "emoji" && avatar.value
      ? `<span style="font-size:34px">${Utils.esc(avatar.value)}</span>`
      : Utils.esc(avatar.value || Utils.initials(user.displayName || user.username));
    const bannerColor = Utils.colorFromUser(user);
    const canDM = me && Store.canDM(me.id, user.id);
    const rel = me ? Store.friendStatus(me.id, user.id) : null;
    return `
      <div class="profile-card">
        <div class="profile-banner" style="background:linear-gradient(135deg, ${bannerColor}, var(--accent))"></div>
        <div class="profile-body">
          <div class="profile-avatar" style="background:${bannerColor}">${avatarInner}</div>
          <div class="profile-name">${Utils.esc(user.displayName || user.username)}</div>
          <div class="profile-username">${Utils.esc(user.username)}</div>
          <div style="margin-top:8px;font-size:13px;color:var(--text-muted)">${statusLabel(status)}</div>
          ${user.bio ? `<div class="profile-bio">${Utils.esc(user.bio)}</div>` : ""}
          ${me && me.id !== user.id ? `<div class="profile-actions">
            ${canDM ? `<button class="btn btn-primary btn-small" data-profile-action="message">Message</button>` : ""}
            ${rel === "accepted" ? `<button class="btn btn-ghost btn-small" data-profile-action="remove-friend">Remove Friend</button>` : ""}
            ${!rel || rel === "pending_out" ? `<button class="btn btn-ghost btn-small" data-profile-action="friend">${rel === "pending_out" ? "Friend Request Sent" : "Add Friend"}</button>` : ""}
            ${rel === "pending_in" ? `<button class="btn btn-primary btn-small" data-profile-action="accept-friend">Accept</button><button class="btn btn-ghost btn-small" data-profile-action="decline-friend">Decline</button>` : ""}
            <button class="btn btn-ghost btn-small" data-profile-action="block">Block</button>
          </div>` : ""}
        </div>
      </div>
    `;
  }

  function openProfile(userId, opts = {}) {
    const user = Store.getUser(userId);
    if (!user) return;
    const m = openModal(profileHTML(user, opts), { wide: false });
    m.el.style.width = "min(340px, 100%)";
    m.el.style.padding = "0";
    m.el.style.background = "transparent";
    m.el.style.boxShadow = "none";
    bindProfileActions(m.el, user.id);
  }

  function bindProfileActions(root, userId) {
    root.querySelectorAll("[data-profile-action]").forEach(btn => {
      btn.onclick = () => {
        const action = btn.dataset.profileAction;
        const me = Store.currentUser();
        if (!me) return;
        try {
          if (action === "message") {
            const dm = Store.dmFor(me.id, userId);
            App.openDM(dm.id);
          } else if (action === "friend") {
            Store.friendRequest(me.id, userId);
            UI.toast("Friend request sent");
          } else if (action === "accept-friend") {
            Store.respondFriend(me.id, userId, true);
            UI.toast("Friend request accepted");
          } else if (action === "decline-friend") {
            Store.respondFriend(me.id, userId, false);
            UI.toast("Friend request declined");
          } else if (action === "remove-friend") {
            Store.removeFriend(me.id, userId);
            UI.toast("Friend removed");
          } else if (action === "block") {
            Store.blockUser(me.id, userId);
            UI.toast("User blocked");
          }
        } catch (e) {
          UI.toast(e.message || "Action failed", "error");
        }
        UI.closeModal();
        App.render();
      };
    });
  }

  function emojiPicker(onPick) {
    const picker = document.createElement("div");
    picker.className = "emoji-picker";
    const grid = document.createElement("div");
    grid.className = "emoji-grid";
    for (const emoji of Utils.EMOJIS) {
      const cell = document.createElement("div");
      cell.className = "emoji-cell";
      cell.textContent = emoji;
      cell.onclick = () => { onPick(emoji); picker.remove(); };
      grid.appendChild(cell);
    }
    picker.appendChild(grid);
    return picker;
  }

  return { toast, openModal, closeModal, confirmDialog, contextMenu, closeMenus, copyText, statusLabel, profileHTML, openProfile, emojiPicker };
})();
