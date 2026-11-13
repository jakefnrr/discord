"use strict";

const Servers = (() => {
  function railHTML(me, view) {
    const serverIds = Object.keys(Store.db.servers).filter(id => Store.isMember(id, me.id));
    const dmActive = view && (view.type === "friends" || view.type === "dm");
    const dmUnread = Store.dmList(me.id).reduce((n, x) => n + x.unread, 0);
    let html = `
      <button class="server-icon ${dmActive ? "active" : ""}" data-view="friends" title="Direct Messages" style="background:var(--accent);font-size:0">
        <img src="logo.png" alt="" style="width:44px;height:auto;display:block">
        ${dmUnread ? `<span class="unread-dot"></span>` : ""}
      </button>
      <div class="server-separator"></div>`;

    for (const id of serverIds) {
      const s = Store.getServer(id);
      if (!s) continue;
      const active = view && view.type === "server" && view.serverId === id;
      const unread = s.channels.reduce((n, ch) => n + (ch.type === "text" ? Store.unreadCount(ch, me.id) : 0), 0);
      const iconHtml = s.icon
        ? (s.icon.startsWith("data:") ? `<img src="${s.icon}" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : Utils.esc(s.icon))
        : Utils.initials(s.name);
      html += `
        <button class="server-icon ${active ? "active" : ""}" data-server-id="${id}" title="${Utils.esc(s.name)}" style="font-size:${s.icon ? "22px" : "16px"}">
          ${iconHtml}
          ${unread && !active ? `<span class="unread-dot"></span>` : ""}
        </button>`;
    }
    html += `<button class="server-icon add" id="add-server-btn" title="Add a Server">+</button>`;
    return html;
  }

  function sidebarHTML(view) {
    const me = Store.currentUser();
    if (!me || !view || view.type !== "server") return "";
    const s = Store.getServer(view.serverId);
    if (!s || !Store.isMember(s.id, me.id)) return "";
    const canManage = Store.canManageChannels(s.id, me.id);
    const cats = (s.categories || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
    const chIndex = {};
    s.channels.forEach((c, i) => { chIndex[c.id] = i; });
    const chCmp = (a, b) => ((a.position ?? 1e9) - (b.position ?? 1e9)) || (chIndex[a.id] - chIndex[b.id]);
    let list = "";
    for (const cat of cats) {
      const channels = s.channels.filter(c => c.categoryId === cat.id).sort(chCmp);
      list += categoryHTML(cat, channels, canManage, view);
    }
    const uncategorized = s.channels.filter(c => !cats.some(cat => cat.id === c.categoryId)).sort(chCmp);
    if (uncategorized.length) {
      list += categoryHTML({ id: "__other", name: "Other", collapsed: false, position: 999 }, uncategorized, canManage, view);
    }
    return `
      <div class="server-header" id="server-header">
        <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${Utils.esc(s.name)}</span>
        <span class="chevron">▾</span>
      </div>
      <div class="channel-list" id="channel-list">${list}</div>`;
  }

  function categoryHTML(cat, channels, canManage, view) {
    const realCat = cat.id !== "__other";
    return `
      <div class="channel-category ${cat.collapsed ? "collapsed" : ""}" data-category-header="${cat.id}" ${realCat ? `data-cat-id="${cat.id}"` : ""} ${canManage && realCat ? 'draggable="true"' : ""}>
        <span class="cat-chevron">${cat.collapsed ? "▸" : "▾"}</span>
        <span class="cat-name">${Utils.esc(cat.name)}</span>
        ${canManage && realCat ? `<button class="icon-btn add" data-add-channel-cat="${cat.id}" title="Create Channel" style="width:18px;height:18px;font-size:14px">+</button>` : ""}
      </div>
      ${cat.collapsed ? "" : channels.map(ch => channelItemHTML(ch, view, canManage)).join("")}`;
  }

  function channelItemHTML(ch, view, canManage = false) {
    const me = Store.currentUser();
    const dragAttr = canManage ? 'draggable="true"' : "";
    if (ch.type === "voice") {
      const users = (ch.voiceUsers || []).map(id => Store.getUser(id)).filter(Boolean);
      const active = view && view.type === "server" && view.channelId === ch.id;
      return `
        <div class="channel-item voice-channel ${active ? "active" : ""}" data-voice-channel="${ch.id}" data-ch-id="${ch.id}" ${dragAttr}>
          <span class="voice-icon">🔊</span>
          <span class="channel-name">${Utils.esc(ch.name)}</span>
          ${users.length ? `<span style="font-size:11px;color:var(--text-muted)">${users.length}</span>` : ""}
        </div>
        ${users.map(u => `<div class="voice-user" style="padding-left:26px;font-size:13px;color:var(--text-muted)">• ${Utils.esc(u.displayName || u.username)}</div>`).join("")}`;
    }
    const unread = Store.unreadCount(ch, me.id);
    const active = view && view.type === "server" && view.channelId === ch.id;
    return `
      <div class="channel-item ${active ? "active" : ""}" data-channel-id="${ch.id}" data-ch-id="${ch.id}" ${dragAttr}>
        <span class="hash">#</span>
        <span class="channel-name">${Utils.esc(ch.name)}</span>
        ${unread ? `<span class="unread-count">${unread > 99 ? "99+" : unread}</span>` : ""}
      </div>`;
  }

  function bindRail() {
    const rail = document.querySelector(".server-rail");
    if (!rail) return;
    rail.querySelectorAll("[data-view]").forEach(btn => {
      btn.onclick = () => App.openFriends();
    });
    rail.querySelectorAll("[data-server-id]").forEach(btn => {
      btn.onclick = () => App.openServer(btn.dataset.serverId);
      btn.oncontextmenu = e => {
        e.preventDefault();
        serverMenu(e.clientX, e.clientY, btn.dataset.serverId);
      };
    });
    const add = rail.querySelector("#add-server-btn");
    if (add) {
      add.onclick = e => {
        e.stopPropagation();
        UI.contextMenu(e.clientX, e.clientY, [
          { label: "Create My Own", icon: "➕", fn: openCreateServer },
          { label: "Join a Server", icon: "🔗", fn: openJoinServer }
        ]);
      };
    }
  }

  function serverMenu(x, y, serverId) {
    const s = Store.getServer(serverId);
    const me = Store.currentUser();
    if (!s || !me) return;
    const canChannels = Store.canManageChannels(serverId, me.id);
    const canManage = Store.canManageServer(serverId, me.id);
    const items = [];
    if (canChannels) {
      items.push(
        { label: "New Channel", icon: "#️⃣", fn: () => openChannelModal(serverId, { type: "text" }) },
        { label: "New Category", icon: "📁", fn: () => openCategoryModal(serverId) },
        { sep: true }
      );
    }
    items.push(
      { label: "Invite People", icon: "✉️", fn: () => { UI.copyText(s.inviteCode); UI.toast("Invite code copied"); } },
      { label: "Server Settings", icon: "⚙️", fn: () => openServerSettings(serverId) },
      { sep: true },
      { label: "Leave Server", icon: "🚪", danger: true, fn: () => leaveServerFlow(serverId) }
    );
    if (s.ownerId === me.id) {
      items.push({ label: "Delete Server", icon: "🗑", danger: true, fn: () => deleteServerFlow(serverId) });
    }
    UI.contextMenu(x, y, items);
  }

  function leaveServerFlow(serverId) {
    const s = Store.getServer(serverId);
    if (!s) return;
    UI.confirmDialog({
      title: "Leave Server",
      message: `Are you sure you want to leave ${s.name}?`,
      confirmText: "Leave",
      danger: true,
      onConfirm: () => {
        Store.leaveServer(Store.currentUser().id, serverId);
        UI.toast("You left " + s.name);
        App.render();
      }
    });
  }

  function deleteServerFlow(serverId) {
    const s = Store.getServer(serverId);
    if (!s) return;
    UI.confirmDialog({
      title: "Delete Server",
      message: `This will permanently delete ${s.name}. This cannot be undone.`,
      confirmText: "Delete Server",
      danger: true,
      onConfirm: () => {
        Store.deleteServer(Store.currentUser().id, serverId);
        UI.toast("Server deleted");
        App.render();
      }
    });
  }

  function bindSidebar(view) {
    const sidebar = document.querySelector(".channel-sidebar");
    if (!sidebar) return;
    const header = sidebar.querySelector("#server-header");
    if (header) {
      header.onclick = e => {
        const rect = header.getBoundingClientRect();
        serverMenu(rect.left, rect.bottom + 4, view.serverId);
      };
    }
    sidebar.querySelectorAll("[data-channel-id]").forEach(el => {
      el.onclick = () => App.openChannel(view.serverId, el.dataset.channelId);
      el.oncontextmenu = e => {
        e.preventDefault();
        channelMenu(e.clientX, e.clientY, view.serverId, el.dataset.channelId);
      };
    });
    sidebar.querySelectorAll("[data-voice-channel]").forEach(el => {
      el.onclick = () => joinVoice(el.dataset.voiceChannel);
    });
    sidebar.querySelectorAll("[data-add-channel-cat]").forEach(btn => {
      btn.onclick = e => {
        e.stopPropagation();
        openChannelModal(view.serverId, { type: "text", categoryId: btn.dataset.addChannelCat });
      };
    });
    sidebar.querySelectorAll("[data-category-header]").forEach(el => {
      el.onclick = e => {
        if (e.target.closest("[data-add-channel-cat]")) return;
        const catId = el.dataset.catId;
        if (!catId) return;
        const s = Store.getServer(view.serverId);
        const cat = s && s.categories.find(c => c.id === catId);
        if (cat) Store.updateCategory(Store.currentUser().id, view.serverId, catId, { collapsed: !cat.collapsed });
      };
      el.oncontextmenu = e => {
        e.preventDefault();
        const catId = el.dataset.catId;
        if (catId) categoryMenu(e.clientX, e.clientY, view.serverId, catId);
      };
    });
    const list = sidebar.querySelector("#channel-list");
    if (list) {
      list.oncontextmenu = e => {
        if (e.target.closest(".channel-item, .channel-category, .voice-user")) return;
        e.preventDefault();
        emptyChannelMenu(e.clientX, e.clientY, view.serverId);
      };
    }
    if (Store.canManageChannels(view.serverId, Store.currentUser().id)) initSidebarDrag(view);
  }

  /* ---------- drag & drop reorder ---------- */

  let dragState = null;
  let pendingDrop = null;
  let dropLine = null;

  function sortedCats(s) {
    return (s.categories || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
  }

  function channelOrder(s) {
    const idx = {};
    s.channels.forEach((c, i) => { idx[c.id] = i; });
    return s.channels.slice().sort((a, b) => ((a.position ?? 1e9) - (b.position ?? 1e9)) || (idx[a.id] - idx[b.id]));
  }

  function layoutFromModel(s) {
    const cats = sortedCats(s);
    const catOrder = cats.map(c => c.id);
    const byCat = {};
    catOrder.forEach(id => { byCat[id] = []; });
    byCat["__other"] = [];
    for (const ch of channelOrder(s)) {
      const cid = catOrder.includes(ch.categoryId) ? ch.categoryId : "__other";
      byCat[cid].push(ch.id);
    }
    return { catOrder, byCat };
  }

  function clearDropLine() {
    if (dropLine) { dropLine.remove(); dropLine = null; }
  }

  function placeLineBefore(refEl) {
    clearDropLine();
    dropLine = document.createElement("div");
    dropLine.className = "drop-line";
    refEl.parentNode.insertBefore(dropLine, refEl);
  }

  function placeLineAfter(refEl) {
    clearDropLine();
    dropLine = document.createElement("div");
    dropLine.className = "drop-line";
    refEl.parentNode.insertBefore(dropLine, refEl.nextSibling);
  }

  function placeLineEnd(list) {
    clearDropLine();
    dropLine = document.createElement("div");
    dropLine.className = "drop-line";
    list.appendChild(dropLine);
  }

  function catHeaderEls(list) {
    return [...list.querySelectorAll(".channel-category[data-cat-id]")];
  }

  function computeDrop(e, view) {
    const list = document.querySelector("#channel-list");
    if (!list) return null;
    const s = Store.getServer(view.serverId);
    if (!s) return null;
    const { catOrder, byCat } = layoutFromModel(s);
    const target = e.target;
    const catEl = target.closest ? target.closest(".channel-category[data-cat-id]") : null;
    const chEl = target.closest ? target.closest("[data-ch-id]") : null;

    if (dragState.type === "cat") {
      const headers = catHeaderEls(list);
      const hi = catEl ? headers.indexOf(catEl) : -1;
      if (hi >= 0 && catEl.dataset.catId !== dragState.id) {
        const r = catEl.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        if (before) {
          placeLineBefore(catEl);
          return { kind: "cat", id: dragState.id, beforeCatId: catEl.dataset.catId };
        }
        const next = headers[hi + 1];
        if (next) { placeLineBefore(next); return { kind: "cat", id: dragState.id, beforeCatId: next.dataset.catId }; }
        placeLineEnd(list);
        return { kind: "cat", id: dragState.id, beforeCatId: null };
      }
      // over a channel or empty space -> move to end
      placeLineEnd(list);
      return { kind: "cat", id: dragState.id, beforeCatId: null };
    }

    // channel drag
    if (chEl) {
      const targetId = chEl.dataset.chId;
      if (targetId === dragState.id) { clearDropLine(); return null; }
      const ch2 = s.channels.find(c => c.id === targetId);
      let catId = ch2 && catOrder.includes(ch2.categoryId) ? ch2.categoryId : catOrder[catOrder.length - 1];
      const r = chEl.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      const siblings = byCat[catId] || [];
      const ti = siblings.indexOf(targetId);
      let beforeId;
      if (before) {
        beforeId = targetId;
        placeLineBefore(chEl);
      } else {
        let nextId = siblings[ti + 1];
        if (nextId === dragState.id) nextId = siblings[ti + 2];
        beforeId = nextId || null;
        placeLineAfter(chEl);
      }
      return { kind: "ch", id: dragState.id, catId, beforeId };
    }
    if (catEl) {
      const catId = catEl.dataset.catId;
      placeLineAfter(catEl); // top of that category
      const first = (byCat[catId] || [])[0];
      return { kind: "ch", id: dragState.id, catId, beforeId: first && first !== dragState.id ? first : null };
    }
    const lastCat = catOrder[catOrder.length - 1];
    placeLineEnd(list);
    return { kind: "ch", id: dragState.id, catId: lastCat, beforeId: null };
  }

  function applyDrop(view) {
    if (!pendingDrop) return;
    const s = Store.getServer(view.serverId);
    const me = Store.currentUser();
    if (!s || !me) return;
    const { catOrder, byCat } = layoutFromModel(s);
    const drop = pendingDrop;
    try {
      if (drop.kind === "cat") {
        const order = catOrder.filter(id => id !== drop.id);
        let idx = drop.beforeCatId ? order.indexOf(drop.beforeCatId) : order.length;
        if (idx < 0) idx = order.length;
        order.splice(idx, 0, drop.id);
        Store.reorderLayout(me.id, view.serverId, { categories: order, channels: byCat });
      } else {
        for (const key of Object.keys(byCat)) {
          const i = byCat[key].indexOf(drop.id);
          if (i >= 0) byCat[key].splice(i, 1);
        }
        const list = byCat[drop.catId] || (byCat[drop.catId] = []);
        let idx = drop.beforeId ? list.indexOf(drop.beforeId) : -1;
        if (idx < 0) idx = list.length;
        list.splice(idx, 0, drop.id);
        Store.reorderLayout(me.id, view.serverId, { categories: catOrder, channels: byCat });
      }
      UI.toast("Layout updated");
      App.render();
    } catch (e) { UI.toast(e.message, "error"); }
  }

  function cleanupDrag() {
    dragState = null;
    pendingDrop = null;
    clearDropLine();
    document.querySelectorAll(".dragging").forEach(el => el.classList.remove("dragging"));
  }

  function initSidebarDrag(view) {
    const sidebar = document.querySelector(".channel-sidebar");
    const list = sidebar && sidebar.querySelector("#channel-list");
    if (!list) return;

    sidebar.addEventListener("dragstart", e => {
      const catEl = e.target.closest && e.target.closest(".channel-category[data-cat-id]");
      const chEl = e.target.closest && e.target.closest("[data-ch-id]");
      if (catEl && !chEl) {
        dragState = { type: "cat", id: catEl.dataset.catId };
        catEl.classList.add("dragging");
      } else if (chEl) {
        dragState = { type: "ch", id: chEl.dataset.chId };
        chEl.classList.add("dragging");
      } else {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = "move";
      try { e.dataTransfer.setData("text/plain", dragState.id); } catch (_) {}
    });

    list.addEventListener("dragover", e => {
      if (!dragState) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      pendingDrop = computeDrop(e, view);
    });

    list.addEventListener("drop", e => {
      e.preventDefault();
      if (dragState && pendingDrop) applyDrop(view);
      cleanupDrag();
    });

    list.addEventListener("dragleave", e => {
      if (e.target === list && !list.contains(e.relatedTarget)) clearDropLine();
    });

    sidebar.addEventListener("dragend", cleanupDrag);
  }

  function emptyChannelMenu(x, y, serverId) {
    const me = Store.currentUser();
    const canChannels = Store.canManageChannels(serverId, me.id);
    const items = [];
    if (canChannels) {
      items.push(
        { label: "Create Channel", icon: "#️⃣", fn: () => openChannelModal(serverId, { type: "text" }) },
        { label: "Create Category", icon: "📁", fn: () => openCategoryModal(serverId) }
      );
    } else {
      items.push({ label: "No actions available", icon: "🔒", fn: () => {} });
    }
    UI.contextMenu(x, y, items);
  }

  function categoryMenu(x, y, serverId, catId) {
    const s = Store.getServer(serverId);
    const me = Store.currentUser();
    if (!s || !me || !Store.canManageChannels(serverId, me.id)) return;
    const cat = s.categories.find(c => c.id === catId);
    if (!cat) return;
    UI.contextMenu(x, y, [
      { label: "Add Channel", icon: "#️⃣", fn: () => openChannelModal(serverId, { type: "text", categoryId: catId }) },
      { label: "Edit Category", icon: "✎", fn: () => openCategoryModal(serverId, cat) },
      { sep: true },
      { label: "Delete Category", icon: "🗑", danger: true, fn: () => deleteCategoryFlow(serverId, cat) }
    ]);
  }

  function deleteCategoryFlow(serverId, cat) {
    UI.confirmDialog({
      title: "Delete Category",
      message: `Delete "${cat.name}"? Channels inside will be moved to another category.`,
      confirmText: "Delete",
      danger: true,
      onConfirm: () => {
        try { Store.deleteCategory(Store.currentUser().id, serverId, cat.id); UI.toast("Category deleted"); App.render(); }
        catch (e) { UI.toast(e.message, "error"); }
      }
    });
  }

  function channelMenu(x, y, serverId, channelId) {
    const s = Store.getServer(serverId);
    const ch = s && s.channels.find(c => c.id === channelId);
    if (!ch) return;
    const me = Store.currentUser();
    const canManage = Store.canManageChannels(serverId, me.id);
    const items = [
      { label: "Mark As Read", icon: "✅", fn: () => { Store.markRead(ch, me.id); App.render(); } },
      { label: "Mark As Unread", icon: "🔵", fn: () => { Store.markUnread(ch, me.id); App.render(); } }
    ];
    if (canManage) {
      items.push(
        { label: "Edit Channel", icon: "✎", fn: () => openChannelModal(serverId, { channel: ch }) },
        { sep: true },
        { label: "Delete Channel", icon: "🗑", danger: true, fn: () => deleteChannelFlow(serverId, ch) }
      );
    }
    UI.contextMenu(x, y, items);
  }

  function deleteChannelFlow(serverId, ch) {
    UI.confirmDialog({
      title: "Delete Channel",
      message: `Delete #${ch.name}? This cannot be undone.`,
      confirmText: "Delete",
      danger: true,
      onConfirm: () => {
        try {
          Store.deleteChannel(Store.currentUser().id, serverId, ch.id);
          UI.toast("Channel deleted");
          App.render();
        } catch (e) { UI.toast(e.message, "error"); }
      }
    });
  }

  function joinVoice(channelId) {
    const me = Store.currentUser();
    const view = App.state.view;
    if (!view || view.type !== "server") return;
    try {
      Store.joinVoice(me.id, view.serverId, channelId);
      UI.toast("Joined voice channel");
      App.render();
    } catch (e) { UI.toast(e.message, "error"); }
  }

  /* ---------- modals ---------- */

  function openCreateServer() {
    const m = UI.openModal(`
      <h2>Create Your Server</h2>
      <p class="modal-sub">Your server is where you and your friends hang out.</p>
      <div class="field"><label>Server Name</label><input id="cs-name" maxlength="100" placeholder="My Server"></div>
      <div class="field"><label>Icon (emoji or image, optional)</label><input id="cs-icon" maxlength="8" placeholder="🎮"><input type="file" id="cs-icon-file" accept="image/*" style="margin-top:6px"></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="cs-create">Create</button>
      </div>`);
    m.el.querySelector("[data-close]").onclick = m.close;
    m.el.querySelector("#cs-create").onclick = async () => {
      const name = m.el.querySelector("#cs-name").value.trim();
      let icon = m.el.querySelector("#cs-icon").value.trim();
      const file = m.el.querySelector("#cs-icon-file").files[0];
      if (file) {
        if (file.size > 300 * 1024) { UI.toast("Icon image too large (max 300 KB)", "error"); return; }
        try { icon = await Utils.readFileAsDataURL(file); } catch (e) { UI.toast("Could not read image", "error"); return; }
      }
      if (!name) { UI.toast("Server name is required", "error"); return; }
      const s = Store.createServer(Store.currentUser().id, { name, icon });
      m.close();
      UI.toast("Server created");
      App.openServer(s.id);
    };
  }

  function openJoinServer() {
    const m = UI.openModal(`
      <h2>Join a Server</h2>
      <p class="modal-sub">Enter an invite code to join a server.</p>
      <div class="field"><label>Invite Code</label><input id="js-code" placeholder="e.g. aB3dE5gH" autocomplete="off"></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="js-join">Join</button>
      </div>`);
    m.el.querySelector("[data-close]").onclick = m.close;
    const submit = () => {
      const code = m.el.querySelector("#js-code").value.trim();
      if (!code) return;
      try {
        const s = Store.joinServer(Store.currentUser().id, code);
        m.close();
        UI.toast("Joined " + s.name);
        App.openServer(s.id);
      } catch (e) { UI.toast(e.message, "error"); }
    };
    m.el.querySelector("#js-join").onclick = submit;
    m.el.querySelector("#js-code").onkeydown = e => { if (e.key === "Enter") submit(); };
  }

  function openCategoryModal(serverId, cat = null) {
    const s = Store.getServer(serverId);
    if (!s) return;
    const m = UI.openModal(`
      <h2>${cat ? "Edit Category" : "Create Category"}</h2>
      <div class="field"><label>Category Name</label><input id="cat-name" maxlength="50" value="${cat ? Utils.esc(cat.name) : ""}" placeholder="New Category"></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="cat-save">${cat ? "Save" : "Create Category"}</button>
      </div>`);
    m.el.querySelector("[data-close]").onclick = m.close;
    m.el.querySelector("#cat-save").onclick = () => {
      const name = m.el.querySelector("#cat-name").value.trim();
      try {
        if (cat) Store.updateCategory(Store.currentUser().id, serverId, cat.id, { name });
        else Store.addCategory(Store.currentUser().id, serverId, { name });
        m.close();
        App.render();
      } catch (e) { UI.toast(e.message, "error"); }
    };
  }

  function openChannelModal(serverId, opts = {}) {
    const s = Store.getServer(serverId);
    if (!s) return;
    const editing = opts.channel;
    const type = editing ? editing.type : (opts.type || "text");
    const cats = (s.categories || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0));
    const currentCat = editing ? editing.categoryId : (opts.categoryId || (cats[0] && cats[0].id));
    const m = UI.openModal(`
      <h2>${editing ? "Edit Channel" : "Create Channel"}</h2>
      <div class="field"><label>Channel Type</label>
        <select id="ch-type" ${editing ? "disabled" : ""}>
          <option value="text" ${type === "text" ? "selected" : ""}>Text</option>
          <option value="voice" ${type === "voice" ? "selected" : ""}>Voice</option>
        </select>
      </div>
      <div class="field"><label>Category</label>
        <select id="ch-category">
          ${cats.map(c => `<option value="${c.id}" ${c.id === currentCat ? "selected" : ""}>${Utils.esc(c.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>Channel Name</label><input id="ch-name" maxlength="40" value="${editing ? Utils.esc(editing.name) : ""}" placeholder="new-channel"></div>
      ${type === "text" ? `<div class="field"><label>Topic</label><input id="ch-topic" maxlength="200" value="${editing ? Utils.esc(editing.topic || "") : ""}" placeholder="Let everyone know how to use this channel!"></div>` : ""}
      <div class="modal-footer">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="ch-save">${editing ? "Save" : "Create Channel"}</button>
      </div>`);
    m.el.querySelector("[data-close]").onclick = m.close;
    m.el.querySelector("#ch-save").onclick = () => {
      const name = m.el.querySelector("#ch-name").value.trim();
      const topic = m.el.querySelector("#ch-topic") ? m.el.querySelector("#ch-topic").value.trim() : "";
      const categoryId = m.el.querySelector("#ch-category").value;
      try {
        if (editing) {
          Store.updateChannel(Store.currentUser().id, serverId, editing.id, { name, topic, categoryId });
          m.close();
          App.render();
        } else {
          const ch = Store.addChannel(Store.currentUser().id, serverId, { name, topic, type, categoryId });
          m.close();
          App.openChannel(serverId, ch.id);
        }
      } catch (e) { UI.toast(e.message, "error"); }
    };
  }

  function permLabel(p) {
    const labels = {
      manageChannels: "Manage Channels",
      manageMessages: "Manage Messages",
      manageRoles: "Manage Roles",
      kickMembers: "Kick Members",
      manageServer: "Manage Server"
    };
    return Object.keys(labels).filter(k => p[k]).map(k => labels[k]).join(", ") || "No permissions";
  }

  function openRoleModal(serverId, role = null, reopenSettings = false) {
    const s = Store.getServer(serverId);
    if (!s) return;
    const perms = role ? (role.permissions || {}) : {};
    const permChecks = ["manageChannels", "manageMessages", "manageRoles", "kickMembers", "manageServer"].map(k => `
      <label style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:14px">
        <input type="checkbox" data-perm="${k}" ${perms[k] ? "checked" : ""}> ${permLabel({ [k]: true })}
      </label>`).join("");
    const colors = Utils.COLORS.concat(["#99aab5", "#faa61a", "#eb459e"]);
    const m = UI.openModal(`
      <h2>${role ? "Edit Role" : "Create Role"}</h2>
      <div class="field"><label>Role Name</label><input id="role-name" maxlength="50" value="${role ? Utils.esc(role.name) : ""}" placeholder="New Role"></div>
      <div class="field"><label>Color</label>
        <div class="avatar-picker" id="role-colors">
          ${colors.map(c => `<div class="color-option ${role && role.color === c ? "selected" : ""}" data-color="${c}" style="background:${c}"></div>`).join("")}
        </div>
      </div>
      <div class="field"><label>Permissions</label>${permChecks}</div>
      <div class="modal-footer">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="role-save">${role ? "Save" : "Create Role"}</button>
      </div>`);
    m.el.querySelector("[data-close]").onclick = m.close;
    m.el.querySelectorAll("#role-colors .color-option").forEach(c => {
      c.onclick = () => {
        m.el.querySelectorAll("#role-colors .color-option").forEach(x => x.classList.remove("selected"));
        c.classList.add("selected");
      };
    });
    m.el.querySelector("#role-save").onclick = () => {
      const name = m.el.querySelector("#role-name").value.trim();
      const sel = m.el.querySelector("#role-colors .color-option.selected");
      const color = sel ? sel.dataset.color : (role ? role.color : Utils.COLORS[0]);
      const permissions = {};
      m.el.querySelectorAll("[data-perm]").forEach(cb => { permissions[cb.dataset.perm] = cb.checked; });
      try {
        if (role) Store.updateRole(Store.currentUser().id, serverId, role.id, { name, color, permissions });
        else Store.addRole(Store.currentUser().id, serverId, { name, color, permissions });
        UI.closeModal();
        App.render();
        if (reopenSettings) openServerSettings(serverId);
      } catch (e) { UI.toast(e.message, "error"); }
    };
  }

  function openRoleAssignModal(serverId, memberId, reopenSettings = false) {
    const s = Store.getServer(serverId);
    const me = Store.currentUser();
    if (!s || !me || s.ownerId !== me.id) return;
    const target = s.members[memberId];
    const user = Store.getUser(memberId);
    if (!target || !user) return;
    const assigned = new Set(target.roles || []);
    const checks = (s.roles || []).map(r => `
      <label style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;cursor:pointer" onmouseover="this.style.background='var(--bg-modifier-hover)'" onmouseout="this.style.background=''">
        <input type="checkbox" data-role-id="${r.id}" ${assigned.has(r.id) ? "checked" : ""}>
        <span style="width:12px;height:12px;border-radius:50%;background:${Utils.esc(r.color || "#5865f2")};display:inline-block"></span>
        <span style="font-weight:600">${Utils.esc(r.name)}</span>
        <span style="margin-left:auto;font-size:12px;color:var(--text-muted)">${Utils.esc(permLabel(r.permissions || {}))}</span>
      </label>`).join("") || `<div style="color:var(--text-muted);padding:12px 0">No roles yet. Create roles in Server Settings first.</div>`;
    const m = UI.openModal(`
      <h2>Roles for ${Utils.esc(user.displayName || user.username)}</h2>
      <p class="modal-sub">Check roles to assign. Only the server owner can change roles.</p>
      <div style="display:flex;flex-direction:column;gap:2px">${checks}</div>
      <div class="modal-footer">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="roles-save">Save</button>
      </div>`);
    m.el.querySelector("[data-close]").onclick = m.close;
    m.el.querySelector("#roles-save").onclick = () => {
      const ids = [...m.el.querySelectorAll("[data-role-id]:checked")].map(cb => cb.dataset.roleId);
      try {
        Store.setMemberRoles(me.id, serverId, memberId, ids);
        UI.toast("Roles updated");
        UI.closeModal();
        App.render();
        if (reopenSettings) openServerSettings(serverId);
      } catch (e) { UI.toast(e.message, "error"); }
    };
  }

  function openServerSettings(serverId) {
    const s = Store.getServer(serverId);
    const me = Store.currentUser();
    if (!s || !me) return;
    const canOverview = Store.canManageServer(serverId, me.id);
    const canChannels = Store.canManageChannels(serverId, me.id);
    const canRoles = Store.canManageRoles(serverId, me.id);
    const canKick = Store.canKickMembers(serverId, me.id);
    const isOwner = s.ownerId === me.id;
    const members = Object.keys(s.members).map(id => ({ user: Store.getUser(id), member: s.members[id] })).filter(x => x.user);
    members.sort((a, b) => (a.member.role === "owner" ? -1 : b.member.role === "owner" ? 1 : (a.user.username > b.user.username ? 1 : -1)));
    const roles = (s.roles || []).slice().sort((a, b) => (b.position || 0) - (a.position || 0));

    const m = UI.openModal(`
      <div class="modal-header"><h2>Server Settings</h2><button class="icon-btn" data-close>✕</button></div>
      <div class="section-title">Overview</div>
      <div class="setting-row">
        <div><div class="setting-label">Server Name</div><div class="setting-desc">${Utils.esc(s.name)}</div></div>
        ${canOverview ? `<button class="btn btn-outline btn-small" data-edit="overview">Edit</button>` : ""}
      </div>
      <div class="setting-row">
        <div><div class="setting-label">Icon</div><div class="setting-desc">${s.icon ? (s.icon.startsWith("data:") ? `<img src="${s.icon}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle">` : Utils.esc(s.icon)) : "None"}</div></div>
        ${canOverview ? `<button class="btn btn-outline btn-small" data-edit="icon">Edit</button>` : ""}
      </div>
      <div class="setting-row">
        <div><div class="setting-label">Invite Code</div><div class="setting-desc">${Utils.esc(s.inviteCode)}</div></div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-outline btn-small" data-copy-invite>Copy</button>
          ${canOverview ? `<button class="btn btn-outline btn-small" data-regenerate-invite>Regenerate</button>` : ""}
        </div>
      </div>
      <div class="section-title">Roles ${canRoles ? `<button class="btn btn-primary btn-small" data-add-role>+ Create Role</button>` : ""}</div>
      <div class="member-manage-list" id="role-manage-list">
        ${roles.length ? roles.map(r => `
          <div class="manage-member">
            <span style="width:14px;height:14px;border-radius:50%;background:${Utils.esc(r.color || "#5865f2")};flex-shrink:0"></span>
            <div class="info"><div class="name">${Utils.esc(r.name)}</div><div class="role">${Utils.esc(permLabel(r.permissions || {}))}</div></div>
            ${canRoles ? `<button class="btn btn-ghost btn-small" data-edit-role="${r.id}">Edit</button><button class="btn btn-ghost btn-small" data-delete-role="${r.id}" style="color:var(--red)">Delete</button>` : ""}
          </div>`).join("") : `<div style="padding:12px;color:var(--text-muted);font-size:13px">No roles yet.${canRoles ? " Create one to grant permissions." : ""}</div>`}
      </div>
      <div class="section-title">Channels ${canChannels ? `<button class="btn btn-primary btn-small" data-add-channel-settings>+ Add</button>` : ""}</div>
      <div class="member-manage-list" id="channel-manage-list">
        ${s.channels.map(ch => `
          <div class="manage-member">
            <div class="info"><div class="name">#${Utils.esc(ch.name)} <span style="color:var(--text-faint);font-weight:400;font-size:12px">${ch.type}</span></div><div class="role">${Utils.esc(ch.topic || "")}</div></div>
            ${canChannels ? `<button class="btn btn-ghost btn-small" data-edit-channel="${ch.id}">Edit</button><button class="btn btn-ghost btn-small" data-delete-channel="${ch.id}" style="color:var(--red)">Delete</button>` : ""}
          </div>`).join("")}
      </div>
      <div class="section-title">Members — ${members.length}</div>
      <div class="member-manage-list">
        ${members.map(({ user, member }) => {
          const memberRoles = Store.memberRoleList(s.id, user.id);
          const roleTags = memberRoles.map(r => `<span style="color:${Utils.esc(r.color || "#5865f2")};font-size:11px;font-weight:700">${Utils.esc(r.name)}</span>`).join(" ");
          const canKickTarget = canKick && user.id !== me.id && user.id !== s.ownerId && (isOwner || member.role === "member");
          return `
          <div class="manage-member">
            ${Utils.avatarHtml(user, { size: 32, statusValue: Store.effectiveStatus(user.id) })}
            <div class="info">
              <div class="name">${isOwner ? `<a href="#" data-assign-roles="${user.id}" style="color:inherit">${Utils.esc(user.displayName || user.username)}</a>` : Utils.esc(user.displayName || user.username)}${member.role === "owner" ? ' <span class="member-tag">Owner</span>' : member.role === "admin" ? ' <span class="member-tag">Admin</span>' : ""} ${roleTags}</div>
              <div class="role">${Utils.esc(user.username)}</div>
            </div>
            ${isOwner && user.id !== me.id ? `<select data-role-select="${user.id}" style="background:var(--bg-tertiary);border:1px solid var(--border-subtle);border-radius:4px;padding:4px 8px">
              <option value="member" ${member.role === "member" ? "selected" : ""}>Member</option>
              <option value="admin" ${member.role === "admin" ? "selected" : ""}>Admin</option>
            </select>` : ""}
            ${canKickTarget ? `<button class="btn btn-ghost btn-small" data-kick="${user.id}" style="color:var(--red)">Kick</button>` : ""}
          </div>`;
        }).join("")}
      </div>
      <div class="section-title">Danger Zone</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-outline" id="ss-leave" style="color:var(--red)">Leave Server</button>
        ${isOwner ? `<button class="btn btn-danger" id="ss-delete">Delete Server</button>` : ""}
      </div>`, { wide: true });

    m.el.querySelector("[data-close]").onclick = m.close;
    m.el.querySelectorAll("[data-copy-invite]").forEach(b => b.onclick = () => { UI.copyText(s.inviteCode); UI.toast("Invite code copied"); });
    const regen = m.el.querySelector("[data-regenerate-invite]");
    if (regen) regen.onclick = () => { Store.regenerateInvite(me.id, serverId); UI.toast("Invite regenerated"); m.close(); App.render(); };

    m.el.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editOverviewModal(serverId, b.dataset.edit));
    const addRoleBtn = m.el.querySelector("[data-add-role]");
    if (addRoleBtn) addRoleBtn.onclick = () => openRoleModal(serverId, null, true);
    m.el.querySelectorAll("[data-edit-role]").forEach(b => b.onclick = () => {
      const role = s.roles.find(r => r.id === b.dataset.editRole);
      if (role) openRoleModal(serverId, role, true);
    });
    m.el.querySelectorAll("[data-delete-role]").forEach(b => b.onclick = () => {
      const role = s.roles.find(r => r.id === b.dataset.deleteRole);
      UI.confirmDialog({
        title: "Delete Role",
        message: `Delete role "${role ? role.name : ""}"? It will be removed from all members.`,
        confirmText: "Delete",
        danger: true,
        onConfirm: () => { try { Store.deleteRole(me.id, serverId, b.dataset.deleteRole); UI.toast("Role deleted"); UI.closeModal(); App.render(); openServerSettings(serverId); } catch (e) { UI.toast(e.message, "error"); } }
      });
    });
    const addCh = m.el.querySelector("[data-add-channel-settings]");
    if (addCh) addCh.onclick = () => { m.close(); openChannelModal(serverId, { type: "text" }); };
    m.el.querySelectorAll("[data-edit-channel]").forEach(b => b.onclick = () => {
      const ch = s.channels.find(c => c.id === b.dataset.editChannel);
      if (ch) { m.close(); openChannelModal(serverId, { channel: ch }); }
    });
    m.el.querySelectorAll("[data-delete-channel]").forEach(b => b.onclick = () => {
      const ch = s.channels.find(c => c.id === b.dataset.deleteChannel);
      if (ch) deleteChannelFlow(serverId, ch);
    });
    m.el.querySelectorAll("[data-assign-roles]").forEach(a => {
      a.onclick = e => { e.preventDefault(); openRoleAssignModal(serverId, a.dataset.assignRoles, true); };
    });
    m.el.querySelectorAll("[data-role-select]").forEach(sel => {
      sel.onchange = () => {
        try { Store.setMemberRole(me.id, serverId, sel.dataset.roleSelect, sel.value); UI.toast("Role updated"); UI.closeModal(); App.render(); openServerSettings(serverId); }
        catch (e) { UI.toast(e.message, "error"); }
      };
    });
    m.el.querySelectorAll("[data-kick]").forEach(b => b.onclick = () => {
      const target = b.dataset.kick;
      const u = Store.getUser(target);
      UI.confirmDialog({
        title: "Kick Member",
        message: `Kick ${u ? u.username : "this member"} from the server?`,
        confirmText: "Kick",
        danger: true,
        onConfirm: () => { Store.kickMember(me.id, serverId, target); UI.toast("Member kicked"); UI.closeModal(); App.render(); openServerSettings(serverId); }
      });
    });
    m.el.querySelector("#ss-leave").onclick = () => { m.close(); leaveServerFlow(serverId); };
    const del = m.el.querySelector("#ss-delete");
    if (del) del.onclick = () => { m.close(); deleteServerFlow(serverId); };
  }

  function editOverviewModal(serverId, field) {
    const s = Store.getServer(serverId);
    const me = Store.currentUser();
    if (!s || !Store.canManageServer(serverId, me.id)) return;
    if (field === "overview") {
      const m = UI.openModal(`
        <h2>Edit Server Overview</h2>
        <div class="field"><label>Server Name</label><input id="eo-name" maxlength="100" value="${Utils.esc(s.name)}"></div>
        <div class="field"><label>Topic</label><input id="eo-topic" maxlength="200" value="${Utils.esc(s.channels[0] ? s.channels[0].topic || "" : "")}"></div>
        <div class="modal-footer"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="eo-save">Save</button></div>`);
      m.el.querySelector("[data-close]").onclick = m.close;
      m.el.querySelector("#eo-save").onclick = () => {
        try {
          Store.updateServer(me.id, serverId, { name: m.el.querySelector("#eo-name").value, topic: m.el.querySelector("#eo-topic").value });
          UI.closeModal(); App.render(); openServerSettings(serverId);
        } catch (e) { UI.toast(e.message, "error"); }
      };
    } else if (field === "icon") {
      const m = UI.openModal(`
        <h2>Edit Server Icon</h2>
        <div class="field"><label>Emoji</label><input id="ei-icon" maxlength="8" value="${s.icon && !s.icon.startsWith("data:") ? Utils.esc(s.icon) : ""}" placeholder="🎮"></div>
        <div class="field"><label>Or upload an image</label><input type="file" id="ei-icon-file" accept="image/*"></div>
        <div class="modal-footer"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="ei-save">Save</button></div>`);
      m.el.querySelector("[data-close]").onclick = m.close;
      m.el.querySelector("#ei-save").onclick = async () => {
        const file = m.el.querySelector("#ei-icon-file").files[0];
        let icon = m.el.querySelector("#ei-icon").value.trim();
        if (file) {
          if (file.size > 300 * 1024) { UI.toast("Icon image too large (max 300 KB)", "error"); return; }
          try { icon = await Utils.readFileAsDataURL(file); } catch (e) { UI.toast("Could not read image", "error"); return; }
        }
        try { Store.updateServer(me.id, serverId, { icon }); UI.closeModal(); App.render(); openServerSettings(serverId); }
        catch (e) { UI.toast(e.message, "error"); }
      };
    }
  }

  return { railHTML, sidebarHTML, bindRail, bindSidebar, openCreateServer, openJoinServer, openServerSettings, openChannelModal, openCategoryModal, openRoleModal, openRoleAssignModal };
})();
