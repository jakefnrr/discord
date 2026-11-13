"use strict";

const App = (() => {
  const state = { view: null };
  const voiceState = { muted: false, deafened: false, camera: false };
  let authMode = "login";
  let dmQuery = "";

  function init() {
    Store.initSync();
    Chat.init();
    Voice.init();
    Store.applySettings();
    Store.onState(() => {
      Voice.sync();
      if (Store.isLoggedIn()) renderApp();
      else renderAuth();
    });
    setInterval(() => {
      if (Store.isLoggedIn()) Store.touchPresence();
    }, 10000);
    render();
  }

  function render() {
    if (Store.isLoggedIn()) renderApp();
    else renderAuth();
  }

  /* ---------- auth ---------- */

  function renderAuth() {
    const app = document.getElementById("app");
    const isLogin = authMode === "login";
    app.innerHTML = `
      <div class="auth-screen">
        <div class="auth-card">
          <div class="auth-logo">
            <svg viewBox="0 0 24 24" width="40" height="40"><path fill="#5865F2" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.2.4a18.3 18.3 0 0 1 4.7 2.3 14.6 14.6 0 0 0-12.6 0A18.3 18.3 0 0 1 12 3.4L11.8 3a19.8 19.8 0 0 0-4.9 1.4C3.2 8.6 2.5 12.7 2.9 16.7a19.9 19.9 0 0 0 6 3l.5-.8a12.8 12.8 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a12.8 12.8 0 0 1-2 1l.5.8a19.9 19.9 0 0 0 6-3c.5-4.6-.8-8.6-4.7-12.3ZM8.7 14.3c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Zm6.6 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4Z"/></svg>
            <h1>Discord</h1>
          </div>
          <h2>${isLogin ? "Welcome back!" : "Create an account"}</h2>
          <p class="auth-sub">${isLogin ? "We're so excited to see you again!" : "Join the clone and start chatting."}</p>
          <form id="auth-form" autocomplete="off">
            ${!isLogin ? `<div class="field"><label>Display Name</label><input name="displayName" maxlength="64" placeholder="How others see you"></div>` : ""}
            <div class="field"><label>Username</label><input name="username" required maxlength="32" placeholder="username"></div>
            <div class="field"><label>Password</label><input name="password" type="password" required placeholder="${isLogin ? "Your password" : "At least 4 characters"}"></div>
            <label class="remember-row"><input type="checkbox" name="remember" checked> Remember me</label>
            <div class="error-text" id="auth-error"></div>
            <div class="auth-actions">
              <button type="submit" class="btn btn-primary" id="auth-submit" style="flex:1">${isLogin ? "Log In" : "Sign Up"}</button>
            </div>
          </form>
          <div class="auth-switch" style="margin-top:16px">
            ${isLogin ? `Need an account? <button id="auth-switch">Register</button>` : `Already have an account? <button id="auth-switch">Log In</button>`}
          </div>
          <p class="hint" style="margin-top:16px;color:var(--text-faint);font-size:12px">Local clone: create multiple accounts to test friends and servers. Invite codes work across accounts in this browser.</p>
        </div>
      </div>`;
    const form = app.querySelector("#auth-form");
    const error = app.querySelector("#auth-error");
    const submit = app.querySelector("#auth-submit");
    app.querySelector("#auth-switch").onclick = () => { authMode = isLogin ? "signup" : "login"; renderAuth(); };
    form.onsubmit = async e => {
      e.preventDefault();
      error.textContent = "";
      submit.disabled = true;
      const fd = new FormData(form);
      try {
        if (isLogin) {
          await Store.login(fd.get("username"), fd.get("password"));
        } else {
          await Store.signup(fd.get("username"), fd.get("displayName"), fd.get("password"), { remember: fd.get("remember") === "on" });
        }
        Store.setOnline(Store.currentUser().id, true);
        state.view = restoreView() || { type: "friends" };
        renderApp();
      } catch (err) {
        error.textContent = err.message || "Something went wrong.";
      } finally {
        submit.disabled = false;
      }
    };
  }

  /* ---------- navigation ---------- */

  function saveView() {
    try { sessionStorage.setItem("dcLastView", JSON.stringify(state.view)); } catch (e) {}
  }

  function restoreView() {
    try {
      const raw = sessionStorage.getItem("dcLastView");
      if (!raw) return null;
      const v = JSON.parse(raw);
      const me = Store.currentUser();
      if (!me) return null;
      if (v.type === "friends") return { type: "friends" };
      if (v.type === "dm" && Store.db.dms[v.id] && Store.db.dms[v.id].userIds.includes(me.id)) return { type: "dm", id: v.id };
      if (v.type === "server" && Store.isMember(v.serverId, me.id)) {
        const s = Store.getServer(v.serverId);
        const ch = s && s.channels.find(c => c.id === v.channelId && c.type === "text");
        return { type: "server", serverId: v.serverId, channelId: ch ? ch.id : (s.channels.find(c => c.type === "text") || s.channels[0]).id };
      }
    } catch (e) {}
    return null;
  }

  function openFriends() {
    document.body.classList.remove("sidebar-open");
    state.view = { type: "friends" };
    saveView();
    renderApp();
  }

  function openServer(serverId) {
    document.body.classList.remove("sidebar-open");
    const me = Store.currentUser();
    const s = Store.getServer(serverId);
    if (!s || !Store.isMember(serverId, me.id)) return;
    const ch = s.channels.find(c => c.type === "text");
    if (!ch) return;
    state.view = { type: "server", serverId, channelId: ch.id };
    saveView();
    renderApp();
    markCurrentRead();
  }

  function openChannel(serverId, channelId) {
    document.body.classList.remove("sidebar-open");
    const me = Store.currentUser();
    const s = Store.getServer(serverId);
    const ch = s && s.channels.find(c => c.id === channelId && c.type === "text");
    if (!ch || !Store.isMember(serverId, me.id)) return;
    state.view = { type: "server", serverId, channelId };
    saveView();
    renderApp();
    markCurrentRead();
  }

  function openDM(dmId) {
    document.body.classList.remove("sidebar-open");
    const me = Store.currentUser();
    const dm = Store.db.dms[dmId];
    if (!dm || !dm.userIds.includes(me.id)) return;
    state.view = { type: "dm", id: dmId };
    saveView();
    renderApp();
    markCurrentRead();
  }

  function markCurrentRead() {
    const container = Chat.containerFor(state.view);
    if (container) Store.markRead(container, Store.currentUser().id);
  }

  /* ---------- app shell ---------- */

  function renderApp() {
    const me = Store.currentUser();
    if (!me) { renderAuth(); return; }
    if (!state.view) state.view = restoreView() || { type: "friends" };
    if (!validView(state.view)) state.view = { type: "friends" };

    const view = state.view;
    const rail = Servers.railHTML(me, view);
    const sidebar = sidebarHTML(view);
    const main = mainHTML(view);
    const members = memberListHTML(view);
    const userPanel = userPanelHTML(me);

    document.getElementById("app").innerHTML = `
      <div class="app">
        <nav class="server-rail">${rail}</nav>
        <aside class="channel-sidebar">${sidebar}</aside>
        <main class="chat-main">
          <div class="mobile-topbar"><button class="icon-btn" id="mobile-nav-btn" title="Menu">☰</button></div>
          ${main}
        </main>
        ${members}
      </div>
      <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
      ${userPanel}`;

    Servers.bindRail();
    if (view.type === "server") Servers.bindSidebar(view);
    else bindDmSidebar(view);
    if (view.type === "friends") Friends.bind();
    if (view.type !== "friends") {
      const container = Chat.containerFor(view);
      Chat.mount(container, view);
      Chat.bindInput(view);
      Chat.bindPinned(view);
    }
    bindUserPanel(me);
    bindVoiceBar(me, view);
  }

  function validView(view) {
    const me = Store.currentUser();
    if (!me || !view) return false;
    if (view.type === "friends") return true;
    if (view.type === "dm") return !!Store.db.dms[view.id];
    if (view.type === "server") {
      const s = Store.getServer(view.serverId);
      return !!(s && Store.isMember(view.serverId, me.id) && s.channels.some(c => c.id === view.channelId));
    }
    return false;
  }

  function sidebarHTML(view) {
    if (view.type === "server") return Servers.sidebarHTML(view);
    return dmSidebarHTML(view);
  }

  function dmSidebarHTML(view) {
    const me = Store.currentUser();
    const dms = Store.dmList(me.id);
    const q = dmQuery.trim().toLowerCase();
    const filtered = q ? dms.filter(d => (d.user.username + " " + (d.user.displayName || "")).toLowerCase().includes(q)) : dms;
    const friendsActive = view.type === "friends";
    return `
      <div class="server-header" style="cursor:default"><span>Direct Messages</span></div>
      <div class="channel-list">
        <div class="channel-category"><span>Friends</span></div>
        <div class="channel-item ${friendsActive ? "active" : ""}" data-dm-nav="friends">
          <span class="hash">👥</span><span class="channel-name">Friends</span>
          ${Store.pendingIncoming(me.id).length ? `<span class="mention-badge">${Store.pendingIncoming(me.id).length}</span>` : ""}
        </div>
        <div class="channel-category"><span>Direct Messages</span><button class="icon-btn add" id="dm-add-friend" title="Add Friend" style="width:18px;height:18px;font-size:14px">+</button></div>
        ${filtered.map(d => dmItemHTML(d, view)).join("") || `<div style="padding:8px;color:var(--text-muted);font-size:13px">No direct messages yet.</div>`}
      </div>`;
  }

  function dmItemHTML(d, view) {
    const u = d.user;
    const active = view.type === "dm" && view.id === d.dm.id;
    const status = Store.effectiveStatus(u.id);
    const preview = d.last ? (d.last.deleted ? "Message deleted" : d.last.content.slice(0, 40) || "Attachment") : "No messages yet";
    return `
      <div class="channel-item ${active ? "active" : ""}" data-dm-id="${d.dm.id}" style="align-items:flex-start;padding:8px">
        ${Utils.avatarHtml(u, { size: 32, statusValue: status })}
        <div style="flex:1;min-width:0">
          <div class="channel-name" style="font-size:14px">${Utils.esc(u.displayName || u.username)}</div>
          <div style="font-size:12px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Utils.esc(preview)}</div>
        </div>
        ${d.unread ? `<span class="unread-count">${d.unread > 99 ? "99+" : d.unread}</span>` : ""}
      </div>`;
  }

  function bindDmSidebar(view) {
    const sidebar = document.querySelector(".channel-sidebar");
    if (!sidebar) return;
    sidebar.querySelectorAll("[data-dm-nav]").forEach(el => el.onclick = openFriends);
    sidebar.querySelectorAll("[data-dm-id]").forEach(el => el.onclick = () => openDM(el.dataset.dmId));
    const add = sidebar.querySelector("#dm-add-friend");
    if (add) add.onclick = () => { Friends.state.tab = "add"; openFriends(); };
  }

  /* ---------- main ---------- */

  function mainHTML(view) {
    if (view.type === "friends") return Friends.render();
    const container = Chat.containerFor(view);
    if (!container) { state.view = { type: "friends" }; return Friends.render(); }
    const header = chatHeaderHTML(view, container);
    const pinned = Chat.pinnedBarHTML(container);
    const messages = `<div class="messages">${Chat.render(container, view)}</div>`;
    const typing = Chat.typingHTML(view);
    const input = inputHTML(view);
    return `
      <div class="chat-header">${header}</div>
      ${pinned}
      <div class="voice-grid" id="voice-grid"></div>
      ${messages}
      ${typing}
      <div class="message-input-wrap">${input}</div>
      ${voiceBarHTML(Store.currentUser(), view)}`;
  }

  function chatHeaderHTML(view, container) {
    const me = Store.currentUser();
    if (view.type === "dm") {
      const otherId = container.userIds.find(id => id !== me.id);
      const u = Store.getUser(otherId);
      if (!u) return `<span class="chat-title">Direct Message</span>`;
      const status = Store.effectiveStatus(u.id);
      return `
        ${Utils.avatarHtml(u, { size: 24, statusValue: status })}
        <span class="chat-title">${Utils.esc(u.displayName || u.username)}</span>
        <span class="chat-topic">${Utils.esc(UI.statusLabel(status))} · ${Utils.esc(u.username)}</span>
        <div class="chat-header-actions">
          <input class="chat-search" id="chat-search" placeholder="Search" title="Search messages">
          <button class="icon-btn" title="Pinned Messages" data-header-pins>📌</button>
        </div>`;
    }
    const s = Store.getServer(view.serverId);
    const ch = s && s.channels.find(c => c.id === view.channelId);
    if (!ch) return `<span class="chat-title">Channel</span>`;
    return `
      <span class="chat-title"># ${Utils.esc(ch.name)}</span>
      ${ch.topic ? `<span class="chat-topic">${Utils.esc(ch.topic)}</span>` : ""}
      <div class="chat-header-actions">
        <input class="chat-search" id="chat-search" placeholder="Search" title="Search messages">
        <button class="icon-btn" title="Pinned Messages" data-header-pins>📌</button>
      </div>`;
  }

  function inputHTML(view) {
    const placeholder = view.type === "dm"
      ? `Message @${(Store.getUser(Chat.containerFor(view).userIds.find(id => id !== Store.currentUser().id)) || {}).username || "user"}`
      : `Message #${(Chat.containerFor(view) || {}).name || "channel"}`;
    return `
      <div class="pending-attachments"></div>
      <div class="reply-bar-host"></div>
      <div class="input-tools">
        <button class="icon-btn" data-input-tool="bold" title="Bold"><b>B</b></button>
        <button class="icon-btn" data-input-tool="italic" title="Italic"><i>I</i></button>
        <button class="icon-btn" data-input-tool="underline" title="Underline"><u>U</u></button>
        <button class="icon-btn" data-input-tool="strike" title="Strikethrough"><s>S</s></button>
        <button class="icon-btn" data-input-tool="code" title="Code">\`</button>
        <button class="icon-btn" data-input-tool="codeblock" title="Code Block">{ }</button>
        <button class="icon-btn" data-input-tool="emoji" title="Emoji">☺</button>
        <button class="icon-btn" data-input-tool="poll" title="Create Poll">📊</button>
        <button class="icon-btn" data-input-tool="file" title="Upload a file">📎</button>
      </div>
      <div class="message-input-box">
        <textarea class="message-input" placeholder="${Utils.esc(placeholder)}" rows="1"></textarea>
        <input type="file" id="message-file-input" multiple hidden>
        <button class="icon-btn" data-send title="Send" style="color:var(--accent);font-size:18px">➤</button>
      </div>`;
  }

  /* ---------- members ---------- */

  function memberListHTML(view) {
    const me = Store.currentUser();
    if (view.type === "dm") {
      const container = Chat.containerFor(view);
      const otherId = container.userIds.find(id => id !== me.id);
      const u = Store.getUser(otherId);
      if (!u) return "";
      const status = Store.effectiveStatus(u.id);
      return `
        <aside class="member-list">
          <div class="member-section">
            <div class="member-section-title"><span>Profile</span></div>
            <div class="member-item" data-profile-user="${u.id}">
              ${Utils.avatarHtml(u, { size: 40, statusValue: status })}
              <div>
                <div class="member-name">${Utils.esc(u.displayName || u.username)}</div>
                <div class="member-sub">${Utils.esc(u.username)} · ${Utils.esc(UI.statusLabel(status))}</div>
              </div>
            </div>
            ${u.bio ? `<div style="padding:8px;color:var(--text-muted);font-size:13px">${Utils.esc(u.bio)}</div>` : ""}
          </div>
        </aside>`;
    }
    if (view.type !== "server") return "";
    const s = Store.getServer(view.serverId);
    if (!s) return "";
    const members = Object.keys(s.members).map(id => ({ user: Store.getUser(id), member: s.members[id] })).filter(x => x.user);
    const online = members.filter(m => Store.isOnline(m.user.id));
    const offline = members.filter(m => !Store.isOnline(m.user.id));
    const sortMembers = arr => arr.sort((a, b) => {
      const ra = roleRank(a.member.role), rb = roleRank(b.member.role);
      if (ra !== rb) return ra - rb;
      return (a.user.username || "").localeCompare(b.user.username || "");
    });
    const owner = sortMembers(online.filter(m => m.member.role === "owner"));
    const admins = sortMembers(online.filter(m => m.member.role === "admin"));
    const membersOnline = sortMembers(online.filter(m => m.member.role === "member"));
    const offlineSorted = sortMembers(offline);
    const section = (title, list) => list.length ? `
      <div class="member-section">
        <div class="member-section-title"><span>${title} — ${list.length}</span></div>
        ${list.map(memberItemHTML).join("")}
      </div>` : "";
    return `
      <aside class="member-list">
        ${section("Owner", owner)}
        ${section("Admin", admins)}
        ${section("Online", membersOnline)}
        ${section("Offline", offlineSorted)}
      </aside>`;
  }

  function roleRank(role) { return role === "owner" ? 0 : role === "admin" ? 1 : 2; }

  function memberItemHTML({ user, member }) {
    const status = Store.effectiveStatus(user.id);
    const online = Store.isOnline(user.id);
    const view = state.view;
    const me = Store.currentUser();
    const s = view.type === "server" ? Store.getServer(view.serverId) : null;
    const canKick = view.type === "server" && Store.canKickMembers(view.serverId, me.id);
    const isOwner = s && s.ownerId === user.id;
    const actorIsOwner = s && (s.ownerId === me.id || member.role === "owner");
    const showKick = canKick && user.id !== me.id && !isOwner && (actorIsOwner || member.role === "member");
    const customRoles = s ? Store.memberRoleList(s.id, user.id) : [];
    const roleColor = customRoles.length ? customRoles[0].color : null;
    const roleTags = customRoles.slice(0, 2).map(r => `<span style="color:${Utils.esc(r.color || "#5865f2")};font-size:10px;font-weight:700;margin-left:4px">${Utils.esc(r.name)}</span>`).join("");
    return `
      <div class="member-item" data-member-id="${user.id}">
        ${Utils.avatarHtml(user, { size: 32, statusValue: status })}
        <div style="min-width:0">
          <div class="member-name" ${roleColor ? `style="color:${Utils.esc(roleColor)}"` : ""}>${Utils.esc(user.displayName || user.username)}${member.role === "admin" ? '<span class="member-tag">Admin</span>' : ""}${roleTags}</div>
          <div class="member-sub">${online ? Utils.esc(UI.statusLabel(status)) : "Offline"}</div>
        </div>
        ${showKick ? `<button class="icon-btn" data-kick-member="${user.id}" title="Kick" style="margin-left:auto">⋯</button>` : ""}
      </div>`;
  }

  function bindMembers(view) {
    const list = document.querySelector(".member-list");
    if (!list) return;
    list.querySelectorAll("[data-profile-user],[data-member-id]").forEach(el => {
      el.onclick = e => {
        if (e.target.closest("[data-kick-member]")) return;
        UI.openProfile(el.dataset.profileUser || el.dataset.memberId);
      };
    });
    list.querySelectorAll("[data-kick-member]").forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        const target = btn.dataset.kickMember;
        const u = Store.getUser(target);
        UI.confirmDialog({
          title: "Kick Member",
          message: `Kick ${u ? u.username : "this member"} from the server?`,
          confirmText: "Kick",
          danger: true,
          onConfirm: () => {
            try { Store.kickMember(Store.currentUser().id, view.serverId, target); UI.toast("Member kicked"); App.render(); }
            catch (err) { UI.toast(err.message, "error"); }
          }
        });
      };
    });
  }

  /* ---------- user panel / voice ---------- */

  function userPanelHTML(me) {
    const status = Store.effectiveStatus(me.id);
    return `
      <div class="user-panel" id="user-panel">
        ${Utils.avatarHtml(me, { size: 32, statusValue: status })}
        <div class="user-info">
          <div class="username">${Utils.esc(me.displayName || me.username)}</div>
          <div class="status-text">${Utils.esc(UI.statusLabel(status))}</div>
        </div>
        <button class="icon-btn ${voiceState.muted ? "active" : ""}" id="panel-mute" title="Mute">🎙</button>
        <button class="icon-btn ${voiceState.deafened ? "active" : ""}" id="panel-deafen" title="Deafen">🎧</button>
        <button class="icon-btn" id="panel-settings" title="User Settings">⚙</button>
      </div>`;
  }

  function bindUserPanel(me) {
    const panel = document.getElementById("user-panel");
    if (!panel) return;
    panel.onclick = e => {
      if (e.target.closest("#panel-settings")) { Settings.open(); return; }
      if (e.target.closest("#panel-mute")) { voiceState.muted = !voiceState.muted; Voice.setMicMuted(voiceState.muted); renderApp(); return; }
      if (e.target.closest("#panel-deafen")) { voiceState.deafened = !voiceState.deafened; Voice.setDeafened(voiceState.deafened); renderApp(); return; }
      if (!e.target.closest("button")) Settings.open();
    };
    panel.oncontextmenu = e => {
      e.preventDefault();
      UI.contextMenu(e.clientX, e.clientY, [
        { label: "User Settings", icon: "⚙️", fn: () => Settings.open() },
        { sep: true },
        { label: "Log Out", icon: "🚪", danger: true, fn: () => { Store.logout(); renderAuth(); } }
      ]);
    };
  }

  function voiceBarHTML(me, view) {
    if (view.type !== "server") return "";
    const ch = Store.voiceChannelFor(me.id, view.serverId);
    if (!ch) return "";
    return `
      <div class="voice-connected-bar">
        <span>🔊</span>
        <span>Voice Connected</span>
        <span class="channel-name">#${Utils.esc(ch.name)}</span>
        <span class="spacer"></span>
        <button class="icon-btn ${voiceState.muted ? "active" : ""}" id="vb-mute" title="Mute">${voiceState.muted ? "🔇" : "🎙"}</button>
        <button class="icon-btn ${voiceState.deafened ? "active" : ""}" id="vb-deafen" title="Deafen">${voiceState.deafened ? "🔕" : "🎧"}</button>
        <button class="icon-btn ${voiceState.camera ? "active" : ""}" id="vb-cam" title="Camera">${voiceState.camera ? "📹" : "🚫"}</button>
        <button class="icon-btn" id="vb-disconnect" title="Disconnect">📞</button>
      </div>`;
  }

  function bindVoiceBar(me, view) {
    const bar = document.querySelector(".voice-connected-bar");
    if (!bar) return;
    bar.querySelector("#vb-mute").onclick = () => { voiceState.muted = !voiceState.muted; Voice.setMicMuted(voiceState.muted); renderApp(); };
    bar.querySelector("#vb-deafen").onclick = () => { voiceState.deafened = !voiceState.deafened; Voice.setDeafened(voiceState.deafened); renderApp(); };
    bar.querySelector("#vb-cam").onclick = async () => { voiceState.camera = await Voice.toggleCamera(); renderApp(); };
    bar.querySelector("#vb-disconnect").onclick = () => {
      const ch = Store.voiceChannelFor(me.id, view.serverId);
      if (ch) Store.leaveVoice(me.id, view.serverId, ch.id);
      Voice.leave();
      voiceState.camera = false;
      renderApp();
    };
  }

  /* ---------- header pins ---------- */

  function bindHeaderActions(view) {
    const btn = document.querySelector("[data-header-pins]");
    if (btn) btn.onclick = () => Chat.openPinned(Chat.containerFor(view), view);
    const search = document.querySelector("#chat-search");
    if (search) {
      search.oninput = () => {
        const q = search.value.trim().toLowerCase();
        const wrap = document.querySelector(".messages");
        if (!wrap) return;
        let shown = 0;
        wrap.querySelectorAll(".message-group").forEach(g => {
          const hit = !q || g.textContent.toLowerCase().includes(q);
          g.style.display = hit ? "" : "none";
          if (hit) shown++;
        });
        wrap.querySelectorAll(".day-divider").forEach(d => { d.style.display = ""; });
        let note = wrap.querySelector(".search-note");
        if (q && !note) {
          note = document.createElement("div");
          note.className = "search-note";
          wrap.prepend(note);
        }
        if (note) {
          if (!q) note.remove();
          else note.textContent = shown ? `${shown} result${shown === 1 ? "" : "s"} for "${search.value.trim()}"` : `No results for "${search.value.trim()}"`;
        }
      };
    }
  }

  function bindMobileNav() {
    const btn = document.getElementById("mobile-nav-btn");
    const backdrop = document.getElementById("sidebar-backdrop");
    const close = () => document.body.classList.remove("sidebar-open");
    if (btn) btn.onclick = () => document.body.classList.toggle("sidebar-open");
    if (backdrop) backdrop.onclick = close;
  }

  // Patch renderApp to bind header actions + members
  const _renderApp = renderApp;
  renderApp = function () {
    _renderApp();
    bindMembers(state.view);
    bindHeaderActions(state.view);
    bindMobileNav();
  };

  return {
    init, render, state,
    openFriends, openServer, openChannel, openDM
  };
})();

window.__dc = { Store, App, Chat, Servers, UI, Friends, Settings, Utils, Voice };
window.addEventListener("DOMContentLoaded", () => App.init());
