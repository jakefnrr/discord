"use strict";

const Friends = (() => {
  const state = { tab: "online", query: "" };

  function render() {
    const me = Store.currentUser();
    if (!me) return "";
    const tabs = [
      ["online", "Online"],
      ["all", "All"],
      ["pending", "Pending"],
      ["add", "Add Friend"],
      ["blocked", "Blocked"]
    ];
    return `
      <div class="friends-view">
        <div class="friends-header"><h2>Friends</h2></div>
        <div class="friends-tabs">
          ${tabs.map(([key, label]) => `<button class="friends-tab ${state.tab === key ? "active" : ""}" data-friend-tab="${key}">${label}${key === "pending" ? pendingBadge(me.id) : ""}</button>`).join("")}
        </div>
        <div class="friends-body" data-friends-body>
          ${bodyHTML(me)}
        </div>
      </div>`;
  }

  function pendingBadge(meId) {
    const n = Store.pendingIncoming(meId).length;
    return n ? ` <span class="mention-badge" style="margin-left:4px">${n}</span>` : "";
  }

  function bodyHTML(me) {
    if (state.tab === "add") return addFriendHTML();
    if (state.tab === "pending") return pendingHTML(me);
    if (state.tab === "blocked") return blockedHTML(me);
    const friends = Store.friendList(me.id);
    const online = friends.filter(f => Store.isOnline(f.user.id));
    const list = state.tab === "online" ? online : friends;
    const q = state.query.trim().toLowerCase();
    const filtered = q ? list.filter(f => (f.user.username + " " + (f.user.displayName || "")).toLowerCase().includes(q)) : list;
    if (!filtered.length) {
      return `<div class="empty-list">${state.tab === "online" ? "No friends are online right now." : "No friends found."}</div>`;
    }
    return `<div class="friends-search"><input id="friend-search" placeholder="Search" value="${Utils.esc(state.query)}"></div>` +
      filtered.map(f => friendRowHTML(f, me)).join("");
  }

  function friendRowHTML(f, me) {
    const u = f.user;
    const status = Store.effectiveStatus(u.id);
    const online = Store.isOnline(u.id);
    return `
      <div class="friend-row" data-friend-id="${u.id}">
        ${Utils.avatarHtml(u, { size: 36, statusValue: status })}
        <div class="friend-info">
          <div class="friend-name">${Utils.esc(u.displayName || u.username)}</div>
          <div class="friend-sub">${online ? Utils.esc(UI.statusLabel(status)) : "Offline"} · ${Utils.esc(u.username)}</div>
        </div>
        <div class="friend-actions">
          <button class="btn btn-primary btn-small" data-friend-action="message" data-user-id="${u.id}">Message</button>
          <button class="icon-btn" data-friend-action="more" data-user-id="${u.id}" title="More">⋯</button>
        </div>
      </div>`;
  }

  function addFriendHTML() {
    return `
      <div style="max-width:520px">
        <h3 style="margin:0 0 8px">Add Friend</h3>
        <p style="color:var(--text-muted);margin:0 0 16px">You can add friends with their username.</p>
        <div style="display:flex;gap:8px">
          <input id="add-friend-input" placeholder="You can add friends with their username" style="flex:1;background:var(--bg-tertiary);border:1px solid var(--border-subtle);border-radius:4px;padding:10px 12px">
          <button class="btn btn-primary" id="add-friend-btn">Send Friend Request</button>
        </div>
        <div id="add-friend-error" class="error-text"></div>
      </div>`;
  }

  function pendingHTML(me) {
    const incoming = Store.pendingIncoming(me.id);
    const outgoing = Store.pendingOutgoing(me.id);
    let html = "";
    if (incoming.length) {
      html += `<div class="section-title">Incoming — ${incoming.length}</div>`;
      html += incoming.map(f => `
        <div class="friend-row">
          ${Utils.avatarHtml(f.user, { size: 36, statusValue: Store.effectiveStatus(f.user.id) })}
          <div class="friend-info">
            <div class="friend-name">${Utils.esc(f.user.displayName || f.user.username)}</div>
            <div class="friend-sub">${Utils.esc(f.user.username)}</div>
          </div>
          <div class="friend-actions">
            <button class="btn btn-primary btn-small" data-pending-action="accept" data-user-id="${f.user.id}">Accept</button>
            <button class="btn btn-ghost btn-small" data-pending-action="decline" data-user-id="${f.user.id}">Ignore</button>
          </div>
        </div>`).join("");
    }
    if (outgoing.length) {
      html += `<div class="section-title">Outgoing — ${outgoing.length}</div>`;
      html += outgoing.map(f => `
        <div class="friend-row">
          ${Utils.avatarHtml(f.user, { size: 36, statusValue: Store.effectiveStatus(f.user.id) })}
          <div class="friend-info">
            <div class="friend-name">${Utils.esc(f.user.displayName || f.user.username)}</div>
            <div class="friend-sub">Friend request sent</div>
          </div>
          <div class="friend-actions">
            <button class="btn btn-ghost btn-small" data-pending-action="cancel" data-user-id="${f.user.id}">Cancel</button>
          </div>
        </div>`).join("");
    }
    if (!html) html = `<div class="empty-list">No pending friend requests.</div>`;
    return html;
  }

  function blockedHTML(me) {
    const blocked = Object.keys(Store.friendMap(me.id))
      .filter(id => Store.friendStatus(me.id, id) === "blocked")
      .map(id => Store.getUser(id))
      .filter(Boolean);
    if (!blocked.length) return `<div class="empty-list">You haven't blocked anyone.</div>`;
    return blocked.map(u => `
      <div class="friend-row">
        ${Utils.avatarHtml(u, { size: 36, statusValue: "offline" })}
        <div class="friend-info">
          <div class="friend-name">${Utils.esc(u.displayName || u.username)}</div>
          <div class="friend-sub">${Utils.esc(u.username)}</div>
        </div>
        <div class="friend-actions">
          <button class="btn btn-ghost btn-small" data-blocked-action="unblock" data-user-id="${u.id}">Unblock</button>
        </div>
      </div>`).join("");
  }

  function bind() {
    const me = Store.currentUser();
    if (!me) return;
    document.querySelectorAll(".friends-tab").forEach(btn => {
      btn.onclick = () => { state.tab = btn.dataset.friendTab; App.render(); };
    });
    const body = document.querySelector("[data-friends-body]");
    if (!body) return;

    const search = body.querySelector("#friend-search");
    if (search) {
      search.oninput = Utils.debounce(() => { state.query = search.value; App.render(); }, 200);
    }

    const addInput = body.querySelector("#add-friend-input");
    const addBtn = body.querySelector("#add-friend-btn");
    const err = body.querySelector("#add-friend-error");
    const submit = () => {
      const name = (addInput.value || "").trim();
      if (!name) { err.textContent = "Enter a username."; return; }
      const target = Store.userByUsername(name);
      if (!target) { err.textContent = "User not found."; return; }
      try {
        Store.friendRequest(me.id, target.id);
        UI.toast("Friend request sent to " + target.username);
        App.render();
      } catch (e) {
        err.textContent = e.message;
      }
    };
    if (addBtn) addBtn.onclick = submit;
    if (addInput) addInput.onkeydown = e => { if (e.key === "Enter") submit(); };

    body.querySelectorAll("[data-friend-action]").forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const userId = btn.dataset.userId;
        const action = btn.dataset.friendAction;
        if (action === "message") {
          const dm = Store.dmFor(me.id, userId);
          App.openDM(dm.id);
        } else if (action === "more") {
          const u = Store.getUser(userId);
          UI.contextMenu(e.clientX, e.clientY, [
            { label: "View Profile", icon: "👤", fn: () => UI.openProfile(userId) },
            { sep: true },
            { label: "Remove Friend", icon: "👋", danger: true, fn: () => { Store.removeFriend(me.id, userId); UI.toast("Friend removed"); App.render(); } },
            { label: "Block", icon: "🚫", danger: true, fn: () => { Store.blockUser(me.id, userId); UI.toast("User blocked"); App.render(); } }
          ]);
        }
      };
    });

    body.querySelectorAll("[data-friend-id]").forEach(row => {
      row.onclick = e => {
        if (e.target.closest("button")) return;
        UI.openProfile(row.dataset.friendId);
      };
    });

    body.querySelectorAll("[data-pending-action]").forEach(btn => {
      btn.onclick = () => {
        const userId = btn.dataset.userId;
        const action = btn.dataset.pendingAction;
        if (action === "accept") { Store.respondFriend(me.id, userId, true); UI.toast("Friend request accepted"); }
        else if (action === "decline") { Store.respondFriend(me.id, userId, false); UI.toast("Friend request declined"); }
        else if (action === "cancel") { Store.respondFriend(me.id, userId, false); UI.toast("Friend request canceled"); }
        App.render();
      };
    });

    body.querySelectorAll("[data-blocked-action]").forEach(btn => {
      btn.onclick = () => {
        Store.unblockUser(me.id, btn.dataset.userId);
        UI.toast("User unblocked");
        App.render();
      };
    });
  }

  return { render, bind, state };
})();
