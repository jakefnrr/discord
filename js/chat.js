"use strict";

const Chat = (() => {
  const pendingAttachments = {};
  const typingState = {};
  const replyState = {};
  let typingBC = null;
  let typingStopTimer = null;
  let lastScrollKey = null;

  function viewKey(view) {
    if (!view) return "";
    return view.type === "dm" ? "dm:" + view.id : "server:" + view.serverId + ":" + view.channelId;
  }

  function containerFor(view) { return Store.containerForView(view); }

  function mentionMap() {
    const map = {};
    const db = Store.db;
    if (!db) return map;
    for (const id in db.users) {
      const u = db.users[id];
      if (u.username) map[u.username.toLowerCase()] = u;
    }
    return map;
  }

  function init() {
    if (typingBC) return;
    try {
      typingBC = new BroadcastChannel("dc-typing");
      typingBC.onmessage = e => {
        const d = e.data;
        if (!d || d.type !== "typing") return;
        const key = d.viewKey;
        typingState[key] = typingState[key] || {};
        if (d.active === false) delete typingState[key][d.userId];
        else typingState[key][d.userId] = Date.now();
        updateTypingIndicator(key);
      };
    } catch (e) {}
    window.addEventListener("beforeunload", () => broadcastTyping(false));
  }

  function broadcastTyping(active) {
    try {
      if (typingBC) typingBC.postMessage({ type: "typing", viewKey: currentTypingKey, userId: Store.currentUser() && Store.currentUser().id, active });
    } catch (e) {}
  }

  let currentTypingKey = "";

  function typingUsers(view) {
    const key = viewKey(view);
    const state = typingState[key] || {};
    const now = Date.now();
    const out = [];
    for (const userId in state) {
      if (now - state[userId] > 5000) { delete state[userId]; continue; }
      const me = Store.currentUser();
      if (me && userId === me.id) continue;
      const u = Store.getUser(userId);
      if (u && Store.isOnline(userId)) out.push(u);
    }
    return out;
  }

  function typingHTML(view) {
    const users = typingUsers(view);
    if (!users.length) return `<div class="typing-indicator"></div>`;
    const names = users.slice(0, 3).map(u => Utils.esc(u.displayName || u.username)).join(", ");
    const verb = users.length === 1 ? "is" : "are";
    return `<div class="typing-indicator">${names} ${verb} typing…</div>`;
  }

  function updateTypingIndicator(key) {
    const el = document.querySelector(".chat-main .typing-indicator");
    if (!el) return;
    // Recompute from current view stored on element
    const view = App && App.state ? App.state.view : null;
    if (!view || viewKey(view) !== key) return;
    el.outerHTML = typingHTML(view);
  }

  function render(container, view) {
    const me = Store.currentUser();
    const msgs = (container && container.messages) || [];
    const users = mentionMap();
    if (!msgs.length) return emptyHTML(view);
    let html = "";
    let lastDay = "";
    let prev = null;
    for (const msg of msgs) {
      const day = Utils.fmtDay(msg.ts);
      if (day !== lastDay) {
        html += `<div class="day-divider"><span>${Utils.esc(day)}</span></div>`;
        lastDay = day;
        prev = null;
      }
      html += messageHTML(msg, container, view, me, users, prev);
      prev = msg;
    }
    return html;
  }

  function emptyHTML(view) {
    if (view.type === "dm") {
      return `<div class="empty-state"><h2>It's quiet for now...</h2><p>Send the first message to get things started.</p></div>`;
    }
    const ch = Store.containerForView(view);
    const name = ch ? "#" + ch.name : "this channel";
    return `<div class="empty-state"><h2>Welcome to ${Utils.esc(name)}!</h2><p>This is the start of the ${Utils.esc(name)} channel.</p></div>`;
  }

  function messageHTML(msg, container, view, me, users, prev) {
    if (msg.deleted) {
      return `<div class="message-group"><div class="message deleted-message"><div class="message-main"><div class="message-text" style="color:var(--text-faint);font-style:italic">Message deleted</div></div></div></div>`;
    }
    const author = Store.getUser(msg.authorId);
    if (!author) return "";
    const sameDay = prev && Utils.fmtDay(prev.ts) === Utils.fmtDay(msg.ts);
    const grouped = sameDay && prev && !prev.deleted && prev.authorId === msg.authorId && (msg.ts - prev.ts) < 5 * 60 * 1000;
    const status = Store.effectiveStatus(author.id);
    let nameColor = Utils.hashColor(author.username || author.id);
    if (view && view.type === "server") {
      const rc = Store.memberRoleColor(view.serverId, author.id);
      if (rc) nameColor = rc;
    }
    const content = Utils.md(msg.content, users);
    const attachments = (msg.attachments || []).map(attachmentHTML).join("");
    const reactions = reactionsHTML(msg, me);
    const canEdit = me && msg.authorId === me.id;
    const canDelete = me && (msg.authorId === me.id || (view.type === "server" && Store.canManageServer(view.serverId, me.id)));
    const replyQuote = replyQuoteHTML(msg, container, view);
    const poll = pollHTML(msg, me);
    const actions = `
      <div class="message-actions">
        <button class="icon-btn" data-msg-action="react" data-msg-id="${msg.id}" title="Add Reaction">☺</button>
        <button class="icon-btn" data-msg-action="reply" data-msg-id="${msg.id}" title="Reply">↩</button>
        <button class="icon-btn" data-msg-action="copy" data-msg-id="${msg.id}" title="Copy Text">⧉</button>
        ${canEdit ? `<button class="icon-btn" data-msg-action="edit" data-msg-id="${msg.id}" title="Edit">✎</button>` : ""}
        <button class="icon-btn" data-msg-action="pin" data-msg-id="${msg.id}" title="${msg.pinned ? "Unpin" : "Pin"}">📌</button>
        ${canDelete ? `<button class="icon-btn" data-msg-action="delete" data-msg-id="${msg.id}" title="Delete">🗑</button>` : ""}
      </div>`;
    return `
      <div class="message-group ${grouped ? "grouped" : ""}" data-msg-id="${msg.id}">
        <div class="message ${grouped ? "avatar-hidden" : ""}">
          <div class="avatar-wrap">${Utils.avatarHtml(author, { size: 40, statusValue: status })}</div>
          <div class="message-main">
            <div class="message-meta">
              ${grouped ? `<span class="message-time" style="font-size:11px;color:var(--text-faint)">${Utils.fmtTime(msg.ts)}</span>` : `<span class="message-author" data-author="${author.id}" style="color:${nameColor}">${Utils.esc(author.displayName || author.username)}</span><span class="message-time">${Utils.fmtTime(msg.ts)}</span>`}
              ${msg.edited ? `<span class="message-edited">(edited)</span>` : ""}
            </div>
            ${replyQuote}
            <div class="message-text">${content}</div>
            ${attachments}
            ${poll}
            ${reactions}
          </div>
          ${actions}
        </div>
      </div>`;
  }

  function replyQuoteHTML(msg, container, view) {
    if (!msg.replyTo || !container || !container.messages) return "";
    const target = container.messages.find(m => m.id === msg.replyTo);
    if (!target) return "";
    const author = Store.getUser(target.authorId);
    let color = Utils.hashColor((author && author.username) || target.authorId);
    if (view && view.type === "server") {
      const rc = Store.memberRoleColor(view.serverId, target.authorId);
      if (rc) color = rc;
    }
    const snippet = target.deleted ? "Original message was deleted" : (target.content || "Attachment").slice(0, 120);
    return `<div class="reply-quote" data-jump-to="${target.id}">
      <span class="reply-quote-bar"></span>
      <span class="reply-author" style="color:${color}">${Utils.esc(author ? (author.displayName || author.username) : "Unknown")}</span>
      <span class="reply-snippet">${Utils.esc(snippet)}</span>
    </div>`;
  }

  function pollHTML(msg, me) {
    const p = msg.poll;
    if (!p || !p.options || !p.options.length) return "";
    const total = p.options.reduce((n, o) => n + (o.votes ? o.votes.length : 0), 0);
    const rows = p.options.map((o, i) => {
      const count = o.votes.length;
      const pct = total ? Math.round((count / total) * 100) : 0;
      const mine = me && o.votes.includes(me.id);
      return `<button class="poll-option ${mine ? "voted" : ""}" data-poll-vote="${i}" data-msg-id="${msg.id}">
        <span class="poll-fill" style="width:${pct}%"></span>
        <span class="poll-check">${mine ? "✔" : ""}</span>
        <span class="poll-text">${Utils.esc(o.text)}</span>
        <span class="poll-count">${count}${total ? ` · ${pct}%` : ""}</span>
      </button>`;
    }).join("");
    return `<div class="poll">
      <div class="poll-question">📊 ${Utils.esc(p.question)}</div>
      ${rows}
      <div class="poll-footer">${total} vote${total === 1 ? "" : "s"}${p.multiple ? " · Multiple choice" : ""}</div>
    </div>`;
  }

  function attachmentHTML(att) {
    const isImage = att.type && att.type.startsWith("image/");
    if (isImage && att.url) {
      return `<div class="attachment image" data-attachment="${Utils.esc(JSON.stringify(att))}"><img src="${att.url}" alt="${Utils.esc(att.name)}" loading="lazy"></div>`;
    }
    return `
      <div class="attachment file" data-attachment="${Utils.esc(JSON.stringify(att))}">
        <div class="file-icon">📎</div>
        <div>
          <div class="file-name">${Utils.esc(att.name)}</div>
          <div class="file-size">${Utils.fmtBytes(att.size)}</div>
        </div>
      </div>`;
  }

  function reactionsHTML(msg, me) {
    const entries = Object.entries(msg.reactions || {});
    if (!entries.length) return "";
    const chips = entries.map(([emoji, users]) => {
      const active = me && users.includes(me.id);
      const names = users.map(id => {
        const u = Store.getUser(id);
        return u ? (u.displayName || u.username) : "Unknown";
      }).join(", ");
      return `<button class="reaction ${active ? "active" : ""}" data-reaction="${Utils.esc(emoji)}" data-msg-id="${msg.id}" title="${Utils.esc(names)}"><span>${emoji}</span><span class="count">${users.length}</span></button>`;
    }).join("");
    return `<div class="reactions">${chips}</div>`;
  }

  function mount(container, view) {
    const key = viewKey(view);
    const wrap = document.querySelector(".messages");
    if (!wrap) return;
    const forceScroll = lastScrollKey !== key;
    lastScrollKey = key;
    currentTypingKey = key;

    wrap.onclick = e => {
      const jump = e.target.closest("[data-jump-to]");
      if (jump) {
        const target = wrap.querySelector(`.message-group[data-msg-id="${jump.dataset.jumpTo}"]`);
        if (target) {
          target.scrollIntoView({ block: "center", behavior: "smooth" });
          target.classList.add("flash");
          setTimeout(() => target.classList.remove("flash"), 1600);
        }
        return;
      }
      const pollVote = e.target.closest("[data-poll-vote]");
      if (pollVote) {
        const c = containerFor(view);
        try {
          Store.togglePollVote(c, Store.currentUser().id, pollVote.dataset.msgId, Number(pollVote.dataset.pollVote));
          App.render();
        } catch (err) { UI.toast(err.message, "error"); }
        return;
      }
      const author = e.target.closest("[data-author]");
      if (author) { UI.openProfile(author.dataset.author); return; }
      const reaction = e.target.closest("[data-reaction]");
      if (reaction) {
        const containerNow = containerFor(view);
        const msg = containerNow && Chat.findMessage(containerNow, reaction.dataset.msgId);
        if (msg) Store.toggleReaction(containerNow, Store.currentUser().id, msg.id, reaction.dataset.reaction);
        App.render();
        return;
      }
      const action = e.target.closest("[data-msg-action]");
      if (action) { handleMessageAction(action, container, view, e); return; }
      const att = e.target.closest("[data-attachment]");
      if (att) { handleAttachment(att); return; }
    };

    requestAnimationFrame(() => {
      if (forceScroll) wrap.scrollTop = wrap.scrollHeight;
      else if (wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 140) wrap.scrollTop = wrap.scrollHeight;
    });
  }

  function handleMessageAction(btn, container, view, e) {
    const me = Store.currentUser();
    const msgId = btn.dataset.msgId;
    const action = btn.dataset.msgAction;
    const msg = container && container.messages ? container.messages.find(m => m.id === msgId) : null;
    if (!msg) return;
    if (action === "react") {
      openFloatingPicker(e.clientX, e.clientY, emoji => {
        Store.toggleReaction(container, me.id, msg.id, emoji);
        App.render();
      });
    } else if (action === "reply") {
      replyState[viewKey(view)] = msg.id;
      renderReplyBar(view);
      const input = document.querySelector(".message-input");
      if (input) input.focus();
    } else if (action === "copy") {
      UI.copyText(msg.content || "");
      UI.toast("Message copied");
    } else if (action === "edit") {
      startEdit(btn.closest(".message-group"), container, view, msg);
    } else if (action === "pin") {
      Store.pinMessage(container, me.id, msg.id, view.type === "server" ? view.serverId : null);
      UI.toast(msg.pinned ? "Message unpinned" : "Message pinned");
      App.render();
    } else if (action === "delete") {
      UI.confirmDialog({
        title: "Delete Message",
        message: "Are you sure you want to delete this message?",
        confirmText: "Delete",
        danger: true,
        onConfirm: () => {
          Store.deleteMessage(container, me.id, msg.id, view.type === "server" ? view.serverId : null);
          App.render();
        }
      });
    }
  }

  function startEdit(groupEl, container, view, msg) {
    const textEl = groupEl.querySelector(".message-text");
    if (!textEl || textEl.querySelector("textarea")) return;
    const old = msg.content;
    textEl.innerHTML = "";
    const ta = document.createElement("textarea");
    ta.value = old;
    ta.style.cssText = "width:100%;background:var(--bg-tertiary);border:1px solid var(--accent);border-radius:4px;color:var(--text);padding:8px;font:inherit;font-size:15px;resize:vertical;min-height:44px";
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:8px;margin-top:6px";
    actions.innerHTML = `<button class="btn btn-primary btn-small" data-edit-save>Save</button><button class="btn btn-ghost btn-small" data-edit-cancel>Cancel</button>`;
    textEl.appendChild(ta);
    textEl.appendChild(actions);
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    actions.querySelector("[data-edit-save]").onclick = () => {
      try {
        Store.editMessage(container, Store.currentUser().id, msg.id, ta.value);
        App.render();
      } catch (err) { UI.toast(err.message, "error"); }
    };
    actions.querySelector("[data-edit-cancel]").onclick = () => App.render();
    ta.onkeydown = e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); actions.querySelector("[data-edit-save]").click(); }
      if (e.key === "Escape") actions.querySelector("[data-edit-cancel]").click();
    };
  }

  function handleAttachment(el) {
    let att;
    try { att = JSON.parse(el.dataset.attachment); } catch (e) { return; }
    const isImage = att.type && att.type.startsWith("image/");
    if (isImage && att.url) {
      const m = UI.openModal(`<img src="${att.url}" style="max-width:100%;max-height:80vh;border-radius:8px;display:block;margin:0 auto">`, { wide: true });
      m.el.style.background = "transparent";
      m.el.style.boxShadow = "none";
      m.el.style.maxWidth = "95vw";
    } else if (att.url) {
      downloadDataURL(att.name, att.url);
    }
  }

  function downloadDataURL(name, dataUrl) {
    try {
      const [header, base64] = dataUrl.split(",");
      const mime = header.match(/:(.*?);/) ? header.match(/:(.*?);/)[1] : "application/octet-stream";
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name || "file";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.open(dataUrl, "_blank");
    }
  }

  function openFloatingPicker(x, y, onPick) {
    const picker = UI.emojiPicker(onPick);
    picker.style.position = "fixed";
    picker.style.left = Math.max(8, x - 160) + "px";
    picker.style.top = Math.max(8, y - 340) + "px";
    picker.style.bottom = "auto";
    document.body.appendChild(picker);
    setTimeout(() => {
      document.addEventListener("mousedown", function out(e) {
        if (!picker.contains(e.target)) { picker.remove(); document.removeEventListener("mousedown", out, true); }
      }, true);
    }, 0);
  }

  function pendingFor(view) {
    const key = viewKey(view);
    if (!pendingAttachments[key]) pendingAttachments[key] = [];
    return pendingAttachments[key];
  }

  function renderPending(view) {
    const box = document.querySelector(".pending-attachments");
    if (!box) return;
    const key = viewKey(view);
    const items = pendingAttachments[key] || [];
    box.innerHTML = items.map((att, i) => `
      <div class="pending-attachment" data-pending="${i}">
        <span>${att.type && att.type.startsWith("image/") ? "🖼" : "📎"} ${Utils.esc(att.name)}</span>
        <button class="icon-btn" data-remove-pending="${i}" title="Remove">✕</button>
      </div>`).join("");
    box.querySelectorAll("[data-remove-pending]").forEach(btn => {
      btn.onclick = () => {
        pendingAttachments[key].splice(Number(btn.dataset.removePending), 1);
        renderPending(view);
      };
    });
  }

  function renderReplyBar(view) {
    const host = document.querySelector(".reply-bar-host");
    if (!host) return;
    const key = viewKey(view);
    const msgId = replyState[key];
    const container = containerFor(view);
    const msg = msgId && container ? container.messages.find(m => m.id === msgId) : null;
    if (!msg) { replyState[key] = null; host.innerHTML = ""; return; }
    const author = Store.getUser(msg.authorId);
    host.innerHTML = `
      <div class="reply-bar">
        <span class="reply-bar-label">Replying to <b>${Utils.esc(author ? (author.displayName || author.username) : "Unknown")}</b></span>
        <span class="reply-bar-snippet">${Utils.esc((msg.content || "Attachment").slice(0, 80))}</span>
        <button class="icon-btn" id="reply-cancel" title="Cancel reply">✕</button>
      </div>`;
    host.querySelector("#reply-cancel").onclick = () => {
      replyState[key] = null;
      renderReplyBar(view);
    };
  }

  function bindInput(view) {
    const key = viewKey(view);
    renderReplyBar(view);
    const input = document.querySelector(".message-input");
    const sendBtn = document.querySelector("[data-send]");
    const fileInput = document.querySelector("#message-file-input");
    const tools = document.querySelector(".input-tools");
    if (!input) return;

    renderPending(view);

    const autoResize = () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 200) + "px";
    };
    autoResize();

    const doSend = () => {
      const content = input.value;
      const attachments = (pendingAttachments[key] || []).slice();
      if (!content.trim() && attachments.length === 0) return;
      const container = containerFor(view);
      const replyTo = replyState[key] || null;
      try {
        Store.sendMessage(container, Store.currentUser().id, content, attachments.map(a => ({ id: a.id, name: a.name, size: a.size, type: a.type, url: a.url })), { replyTo });
        pendingAttachments[key] = [];
        replyState[key] = null;
        renderReplyBar(view);
        broadcastTyping(false);
        App.render();
        const ni = document.querySelector(".message-input");
        if (ni) ni.focus();
      } catch (err) {
        UI.toast(err.message || "Failed to send", "error");
      }
    };

    input.oninput = Utils.throttle(() => {
      autoResize();
      broadcastTyping(true);
      if (typingStopTimer) clearTimeout(typingStopTimer);
      typingStopTimer = setTimeout(() => broadcastTyping(false), 2500);
    }, 400);

    input.onkeydown = e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    };

    if (sendBtn) sendBtn.onclick = doSend;

    if (tools) {
      tools.onclick = e => {
        const btn = e.target.closest("[data-input-tool]");
        if (!btn) return;
        const tool = btn.dataset.inputTool;
        if (tool === "file") { fileInput && fileInput.click(); return; }
        if (tool === "poll") { openPollModal(view); return; }
        if (tool === "emoji") {
          const rect = btn.getBoundingClientRect();
          openFloatingPicker(rect.left, rect.bottom + 8, emoji => insertAtCursor(input, emoji));
          return;
        }
        const wraps = {
          bold: ["**", "**"],
          italic: ["*", "*"],
          underline: ["__", "__"],
          strike: ["~~", "~~"],
          code: ["`", "`"],
          codeblock: ["```\n", "\n```"]
        };
        if (wraps[tool]) wrapSelection(input, wraps[tool][0], wraps[tool][1]);
      };
    }

    if (fileInput) {
      fileInput.onchange = async () => {
        const files = Array.from(fileInput.files || []);
        fileInput.value = "";
        for (const file of files.slice(0, 5)) {
          if (file.size > 800 * 1024) { UI.toast(`${file.name} is too large (max 800 KB)`, "error"); continue; }
          try {
            const url = await Utils.readFileAsDataURL(file);
            pendingAttachments[key].push({ id: Utils.uid("att"), name: file.name, size: file.size, type: file.type || "application/octet-stream", url });
            renderPending(view);
          } catch (err) {
            UI.toast("Could not read file", "error");
          }
        }
      };
    }
  }

  function insertAtCursor(el, text) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + text + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + text.length;
    el.focus();
    el.dispatchEvent(new Event("input"));
  }

  function wrapSelection(el, before, after) {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const selected = el.value.slice(start, end);
    const replacement = before + selected + after;
    el.value = el.value.slice(0, start) + replacement + el.value.slice(end);
    el.selectionStart = start + before.length;
    el.selectionEnd = start + before.length + selected.length;
    el.focus();
    el.dispatchEvent(new Event("input"));
  }

  function pinnedMessages(container) {
    if (!container || !container.messages) return [];
    return container.messages.filter(m => m.pinned && !m.deleted);
  }

  function pinnedBarHTML(container) {
    const pinned = pinnedMessages(container);
    if (!pinned.length) return "";
    return `<button class="pinned-bar" data-open-pinned>📌 ${pinned.length} Pinned Message${pinned.length === 1 ? "" : "s"}</button>`;
  }

  function openPinned(container, view) {
    const pinned = pinnedMessages(container);
    if (!pinned.length) return;
    const html = pinned.map(m => {
      const author = Store.getUser(m.authorId);
      return `<div class="pinned-item" data-jump-msg="${m.id}">
        <div class="pinned-author">${Utils.esc(author ? (author.displayName || author.username) : "Unknown")} <span style="color:var(--text-faint);font-weight:400">${Utils.fmtTime(m.ts)}</span></div>
        <div class="pinned-text">${Utils.md(m.content, mentionMap())}</div>
      </div>`;
    }).join("");
    const modal = UI.openModal(`<h2>Pinned Messages</h2><div class="pinned-list">${html}</div>`);
    modal.el.querySelectorAll("[data-jump-msg]").forEach(el => {
      el.onclick = () => {
        UI.closeModal();
        const target = document.querySelector(`.message-group[data-msg-id="${el.dataset.jumpMsg}"]`);
        if (target) target.scrollIntoView({ block: "center", behavior: "smooth" });
      };
    });
  }

  function bindPinned(view) {
    const bar = document.querySelector("[data-open-pinned]");
    if (!bar) return;
    bar.onclick = () => openPinned(containerFor(view), view);
  }

  function openPollModal(view) {
    const m = UI.openModal(`
      <h2>Create a Poll</h2>
      <div class="field"><label>Question</label><input id="poll-q" maxlength="200" placeholder="Ask a question..."></div>
      <div class="field"><label>Options</label>
        <div id="poll-options" style="display:flex;flex-direction:column;gap:6px">
          <input class="poll-opt-input" placeholder="Option 1" maxlength="100">
          <input class="poll-opt-input" placeholder="Option 2" maxlength="100">
        </div>
        <button class="btn btn-ghost btn-small" id="poll-add-opt" style="margin-top:6px">+ Add Option</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:14px;padding:6px 0">
        <input type="checkbox" id="poll-multi"> Allow multiple answers
      </label>
      <div class="modal-footer">
        <button class="btn btn-ghost" data-close>Cancel</button>
        <button class="btn btn-primary" id="poll-create">Create Poll</button>
      </div>`);
    m.el.querySelector("[data-close]").onclick = m.close;
    m.el.querySelector("#poll-add-opt").onclick = () => {
      const wrap = m.el.querySelector("#poll-options");
      if (wrap.querySelectorAll(".poll-opt-input").length >= 10) return;
      const inp = document.createElement("input");
      inp.className = "poll-opt-input";
      inp.maxLength = 100;
      inp.placeholder = "Option " + (wrap.querySelectorAll(".poll-opt-input").length + 1);
      wrap.appendChild(inp);
      inp.focus();
    };
    m.el.querySelector("#poll-create").onclick = () => {
      const question = m.el.querySelector("#poll-q").value.trim();
      const options = [...m.el.querySelectorAll(".poll-opt-input")].map(i => i.value.trim()).filter(Boolean);
      const multiple = m.el.querySelector("#poll-multi").checked;
      const container = containerFor(view);
      try {
        Store.sendMessage(container, Store.currentUser().id, "", [], { poll: { question, options, multiple } });
        m.close();
        App.render();
      } catch (e) { UI.toast(e.message || "Could not create poll", "error"); }
    };
  }

  return {
    init, render, mount, bindInput, bindPinned, pinnedBarHTML, typingHTML, viewKey, containerFor,
    openFloatingPicker, findMessage: (container, id) => container && container.messages ? container.messages.find(m => m.id === id) || null : null,
    openPinned, openPollModal
  };
})();
