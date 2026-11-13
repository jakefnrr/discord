"use strict";

const Store = (() => {
  const DB_KEY = "discordCloneDB.v1";
  const SESSION_KEY = "discordCloneSession";
  const BC_NAME = "discord-clone-sync";

  let db = null;
  let session = null;
  let bc = null;
  const listeners = new Set();

  function defaultDB() {
    return {
      version: 1,
      users: {},
      usernames: {},
      friends: {},
      dms: {},
      servers: {},
      presence: {},
      settings: { theme: "dark", accent: "#5865f2", compact: false }
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      db = raw ? JSON.parse(raw) : defaultDB();
    } catch (e) {
      db = defaultDB();
    }
    if (!db.users) db.users = {};
    if (!db.usernames) db.usernames = {};
    if (!db.friends) db.friends = {};
    if (!db.dms) db.dms = {};
    if (!db.servers) db.servers = {};
    if (!db.presence) db.presence = {};
    if (!db.settings) db.settings = { theme: "dark", accent: "#5865f2", compact: false };
    migrateServers();
    rebuildUsernameIndex();
  }

  function defaultCategories() {
    return [
      { id: Utils.uid("cat"), name: "Text Channels", position: 0, collapsed: false },
      { id: Utils.uid("cat"), name: "Voice Channels", position: 1, collapsed: false }
    ];
  }

  function migrateServers() {
    for (const sid in db.servers) {
      const s = db.servers[sid];
      if (!s.categories || !s.categories.length) s.categories = defaultCategories();
      if (!s.roles) s.roles = [];
      if (!s.channels) s.channels = [];
      s.categories.sort((a, b) => (a.position || 0) - (b.position || 0));
      for (const ch of s.channels) {
        if (!ch.categoryId || !s.categories.some(c => c.id === ch.categoryId)) {
          const fallback = s.categories.find(c => /text/i.test(c.name)) || s.categories[0];
          ch.categoryId = fallback ? fallback.id : null;
        }
        if (ch.type === "voice" && ch.voiceUsers === undefined) ch.voiceUsers = [];
      }
      for (const uid in s.members) {
        if (!s.members[uid].roles) s.members[uid].roles = [];
      }
    }
  }

  function rebuildUsernameIndex() {
    db.usernames = {};
    for (const id in db.users) {
      const u = db.users[id];
      if (u.username) db.usernames[u.username.toLowerCase()] = id;
    }
  }

  function persist() {
    if (!db) return;
    db.updatedAt = Date.now();
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(db));
    } catch (e) {
      console.warn("Discord clone: failed to save (localStorage full?)", e);
    }
    try {
      if (bc) bc.postMessage({ type: "db" });
    } catch (e) {}
    try { if (typeof Cloud !== "undefined") Cloud.push(); } catch (e) {}
  }

  /* Adopt a remote db (from Cloudflare KV) if it is newer than local. */
  function loadRemote(data) {
    if (!data || typeof data !== "object" || !data.users || !data.servers) return false;
    if ((data.updatedAt || 0) <= (db.updatedAt || 0)) return false;
    db = data;
    if (!db.settings) db.settings = { theme: "dark", accent: "#5865f2", compact: false };
    migrateServers();
    rebuildUsernameIndex();
    persist();
    emit();
    return true;
  }

  function save() {
    persist();
    emit();
  }

  function emit() {
    window.dispatchEvent(new CustomEvent("dc:state"));
    listeners.forEach(fn => { try { fn(db); } catch (e) { console.error(e); } });
  }

  function onState(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  function initSync() {
    load();
    session = getStoredSession();
    try {
      bc = new BroadcastChannel(BC_NAME);
      bc.onmessage = () => { load(); emit(); };
    } catch (e) {}
    window.addEventListener("storage", e => {
      if (e.key === DB_KEY) { load(); emit(); }
    });
    window.addEventListener("beforeunload", () => {
      if (session && session.userId) {
        const uid = session.userId;
        for (const sid in db.servers) {
          const s = db.servers[sid];
          if (!s) continue;
          for (const ch of s.channels) if (ch.voiceUsers) ch.voiceUsers = ch.voiceUsers.filter(id => id !== uid);
        }
        persist();
        setOnline(uid, false, true);
      }
    });
    try { if (typeof Cloud !== "undefined") Cloud.init(); } catch (e) {}
  }

  /* ---------- password hashing ---------- */

  function cyrb53(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  }

  async function sha256(str) {
    if (globalThis.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
    }
    return cyrb53(str);
  }

  function randomSalt() { return Utils.uid("salt"); }

  async function hashPassword(password, salt) {
    return sha256("discord-clone::" + salt + "::" + password);
  }

  /* ---------- session ---------- */

  function getStoredSession() {
    // Per-tab session wins so multiple tabs can be logged into different accounts.
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
        return s;
      }
    } catch (e) {}
    return null;
  }

  function setSession(userId, remember) {
    session = { userId, remember: !!remember };
    const raw = JSON.stringify(session);
    try { sessionStorage.setItem(SESSION_KEY, raw); } catch (e) {}
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    try {
      if (session.remember) localStorage.setItem(SESSION_KEY, raw);
    } catch (e) {}
  }

  function clearSession() {
    session = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  function currentUser() {
    if (!session || !db) return null;
    return db.users[session.userId] || null;
  }

  function isLoggedIn() { return !!currentUser(); }

  /* ---------- auth ---------- */

  async function signup(username, displayName, password, opts = {}) {
    username = (username || "").trim();
    displayName = (displayName || username).trim();
    password = password || "";
    if (username.length < 3 || username.length > 32) throw new Error("Username must be 3-32 characters.");
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) throw new Error("Username can only contain letters, numbers, _ . -");
    if (password.length < 4) throw new Error("Password must be at least 4 characters.");
    const key = username.toLowerCase();
    if (db.usernames[key]) throw new Error("That username is taken.");

    const id = Utils.uid("user");
    const salt = randomSalt();
    const passwordHash = await hashPassword(password, salt);
    const user = {
      id,
      username,
      displayName,
      passwordHash,
      salt,
      avatar: opts.avatar || { type: "initials", value: Utils.initials(displayName) },
      status: "online",
      bio: "",
      createdAt: Date.now()
    };
    db.users[id] = user;
    db.usernames[key] = id;
    db.friends[id] = {};
    db.presence[id] = { online: true, lastSeen: Date.now(), status: user.status };
    save();
    setSession(id, opts.remember !== false);
    return user;
  }

  async function login(username, password) {
    username = (username || "").trim();
    password = password || "";
    const id = db.usernames[username.toLowerCase()];
    if (!id) throw new Error("Incorrect username or password.");
    const user = db.users[id];
    const hash = await hashPassword(password, user.salt);
    if (hash !== user.passwordHash) throw new Error("Incorrect username or password.");
    setSession(id, true);
    setOnline(id, true);
    return user;
  }

  function logout() {
    const me = currentUser();
    if (me) setOnline(me.id, false, true);
    clearSession();
    emit();
  }

  /* ---------- presence ---------- */

  function setOnline(userId, online, immediate = false) {
    if (!db.users[userId]) return;
    const p = db.presence[userId] || {};
    p.online = !!online;
    p.lastSeen = Date.now();
    p.status = db.users[userId].status || "online";
    db.presence[userId] = p;
    persist();
    if (!immediate) emit();
  }

  function touchPresence() {
    const me = currentUser();
    if (!me) return;
    const p = db.presence[me.id] || {};
    p.online = true;
    p.lastSeen = Date.now();
    p.status = me.status || "online";
    db.presence[me.id] = p;
    persist();
  }

  function isOnline(userId) {
    const me = currentUser();
    if (me && me.id === userId) return me.status !== "invisible";
    const p = db.presence[userId];
    if (!p || !p.online) return false;
    if (Date.now() - p.lastSeen > 60000) return false;
    const u = db.users[userId];
    if (u && u.status === "invisible") return false;
    return true;
  }

  function effectiveStatus(userId) {
    const u = db.users[userId];
    const p = db.presence[userId];
    if (!isOnline(userId)) return "offline";
    return (p && p.status) || (u && u.status) || "online";
  }

  /* ---------- users / friends ---------- */

  function getUser(id) { return db.users[id] || null; }
  function userByUsername(name) { return db.users[db.usernames[(name || "").toLowerCase()]] || null; }

  function friendStatus(meId, otherId) {
    const rel = db.friends[meId] && db.friends[meId][otherId];
    return rel ? rel.status : null;
  }

  function friendMap(meId) {
    return db.friends[meId] || {};
  }

  function friendIds(meId, statuses) {
    const map = friendMap(meId);
    const out = [];
    for (const otherId in map) {
      if (!statuses || statuses.includes(map[otherId].status)) out.push(otherId);
    }
    return out;
  }

  function friendList(meId) {
    return friendIds(meId, ["accepted"]).map(id => ({ user: getUser(id), rel: friendMap(meId)[id] })).filter(x => x.user);
  }

  function pendingIncoming(meId) {
    return friendIds(meId, ["pending_in"]).map(id => ({ user: getUser(id), rel: friendMap(meId)[id] })).filter(x => x.user);
  }

  function pendingOutgoing(meId) {
    return friendIds(meId, ["pending_out"]).map(id => ({ user: getUser(id), rel: friendMap(meId)[id] })).filter(x => x.user);
  }

  function areFriends(a, b) { return friendStatus(a, b) === "accepted"; }

  function friendRequest(fromId, toId) {
    if (fromId === toId) throw new Error("You can't friend yourself.");
    const target = getUser(toId);
    if (!target) throw new Error("User not found.");
    const existing = friendStatus(fromId, toId);
    if (existing === "accepted") throw new Error("You are already friends.");
    if (existing === "pending_out") throw new Error("Friend request already sent.");
    if (existing === "pending_in") {
      // auto-accept incoming request
      respondFriend(fromId, toId, true);
      return { autoAccepted: true };
    }
    if (existing === "blocked") throw new Error("You can't send a friend request to this user.");
    if (!db.friends[fromId]) db.friends[fromId] = {};
    if (!db.friends[toId]) db.friends[toId] = {};
    db.friends[fromId][toId] = { status: "pending_out", since: Date.now() };
    db.friends[toId][fromId] = { status: "pending_in", since: Date.now() };
    save();
    return { autoAccepted: false };
  }

  function respondFriend(meId, otherId, accept) {
    const rel = friendStatus(meId, otherId);
    if (rel !== "pending_in" && rel !== "pending_out") return false;
    if (!db.friends[meId]) db.friends[meId] = {};
    if (!db.friends[otherId]) db.friends[otherId] = {};
    if (accept) {
      db.friends[meId][otherId] = { status: "accepted", since: Date.now() };
      db.friends[otherId][meId] = { status: "accepted", since: Date.now() };
    } else {
      delete db.friends[meId][otherId];
      delete db.friends[otherId][meId];
    }
    save();
    return true;
  }

  function removeFriend(meId, otherId) {
    if (!db.friends[meId]) db.friends[meId] = {};
    if (!db.friends[otherId]) db.friends[otherId] = {};
    delete db.friends[meId][otherId];
    delete db.friends[otherId][meId];
    save();
  }

  function blockUser(meId, otherId) {
    if (!db.friends[meId]) db.friends[meId] = {};
    if (!db.friends[otherId]) db.friends[otherId] = {};
    db.friends[meId][otherId] = { status: "blocked", since: Date.now() };
    db.friends[otherId][meId] = { status: "blocked", since: Date.now() };
    save();
  }

  function unblockUser(meId, otherId) { removeFriend(meId, otherId); }

  function canDM(a, b) {
    return areFriends(a, b) || getDMId(a, b) !== null;
  }

  /* ---------- DMs ---------- */

  function getDMId(a, b) {
    const pair = [a, b].sort();
    for (const id in db.dms) {
      const dm = db.dms[id];
      if (dm.type === "dm" && dm.userIds.length === 2 && dm.userIds.slice().sort().join() === pair.join()) return id;
    }
    return null;
  }

  function ensureDM(a, b) {
    let id = getDMId(a, b);
    if (id) return db.dms[id];
    id = Utils.uid("dm");
    db.dms[id] = {
      id,
      type: "dm",
      userIds: [a, b],
      messages: [],
      readBy: {},
      createdAt: Date.now()
    };
    save();
    return db.dms[id];
  }

  function dmFor(meId, otherId) { return ensureDM(meId, otherId); }

  function dmList(meId) {
    return Object.values(db.dms)
      .filter(dm => dm.type === "dm" && dm.userIds.includes(meId))
      .map(dm => {
        const otherId = dm.userIds.find(x => x !== meId);
        const user = getUser(otherId);
        const last = dm.messages[dm.messages.length - 1];
        return { dm, user, last, unread: unreadCount(dm, meId) };
      })
      .filter(x => x.user)
      .sort((a, b) => (b.last ? b.last.ts : b.dm.createdAt) - (a.last ? a.last.ts : a.dm.createdAt));
  }

  /* ---------- servers ---------- */

  function inviteExists(code) {
    const c = (code || "").toLowerCase();
    for (const id in db.servers) if (db.servers[id].inviteCode.toLowerCase() === c) return true;
    return false;
  }

  function uniqueInvite() {
    let code;
    do { code = Utils.randomInvite(); } while (inviteExists(code));
    return code;
  }

  function createServer(userId, data = {}) {
    const name = (data.name || "New Server").trim().slice(0, 100) || "New Server";
    const id = Utils.uid("server");
    const generalId = Utils.uid("channel");
    const voiceId = Utils.uid("channel");
    const cats = defaultCategories();
    const textCat = cats[0].id;
    const voiceCat = cats[1].id;
    db.servers[id] = {
      id,
      name,
      icon: data.icon || "",
      ownerId: userId,
      inviteCode: uniqueInvite(),
      createdAt: Date.now(),
      categories: cats,
      roles: [],
      members: { [userId]: { role: "owner", joinedAt: Date.now(), roles: [] } },
      channels: [
        { id: generalId, name: "general", type: "text", categoryId: textCat, topic: "General discussion", messages: [], readBy: {}, voiceUsers: undefined },
        { id: voiceId, name: "Voice", type: "voice", categoryId: voiceCat, topic: "", voiceUsers: [], readBy: {} }
      ]
    };
    delete db.servers[id].channels[0].voiceUsers;
    db.servers[id].channels[0].readBy[userId] = Date.now();
    save();
    return db.servers[id];
  }

  function serverByInvite(code) {
    const c = (code || "").trim().toLowerCase();
    for (const id in db.servers) {
      if (db.servers[id].inviteCode.toLowerCase() === c) return db.servers[id];
    }
    return null;
  }

  function getServer(id) { return db.servers[id] || null; }

  function isMember(serverId, userId) {
    const s = db.servers[serverId];
    return !!(s && s.members && s.members[userId]);
  }

  function memberRole(serverId, userId) {
    const s = db.servers[serverId];
    return s && s.members[userId] ? s.members[userId].role : null;
  }

  const PERMISSION_KEYS = ["manageChannels", "manageMessages", "manageRoles", "kickMembers", "manageServer"];

  function memberBase(serverId, userId) {
    const s = db.servers[serverId];
    return s && s.members ? s.members[userId] || null : null;
  }

  function roleById(serverId, roleId) {
    const s = db.servers[serverId];
    return s && s.roles ? s.roles.find(r => r.id === roleId) || null : null;
  }

  function memberCustomRoles(serverId, userId) {
    const m = memberBase(serverId, userId);
    if (!m || !m.roles || !m.roles.length) return [];
    const s = db.servers[serverId];
    if (!s || !s.roles) return [];
    return m.roles.map(id => s.roles.find(r => r.id === id)).filter(Boolean).sort((a, b) => (b.position || 0) - (a.position || 0));
  }

  function permissions(serverId, userId) {
    const p = { manageChannels: false, manageMessages: false, manageRoles: false, kickMembers: false, manageServer: false };
    const s = db.servers[serverId];
    const m = memberBase(serverId, userId);
    if (!s || !m) return p;
    if (s.ownerId === userId || m.role === "owner" || m.role === "admin") {
      PERMISSION_KEYS.forEach(k => { p[k] = true; });
      return p;
    }
    for (const r of memberCustomRoles(serverId, userId)) {
      const rp = r.permissions || {};
      for (const k of PERMISSION_KEYS) if (rp[k]) p[k] = true;
    }
    return p;
  }

  function canManageChannels(serverId, userId) { return permissions(serverId, userId).manageChannels; }
  function canManageMessages(serverId, userId) { return permissions(serverId, userId).manageMessages; }
  function canManageRoles(serverId, userId) { return permissions(serverId, userId).manageRoles; }
  function canKickMembers(serverId, userId) { return permissions(serverId, userId).kickMembers; }
  function canManageServer(serverId, userId) { return permissions(serverId, userId).manageServer; }

  function memberRoleColor(serverId, userId) {
    const roles = memberCustomRoles(serverId, userId);
    return roles.length ? roles[0].color || null : null;
  }

  function memberRoleList(serverId, userId) {
    return memberCustomRoles(serverId, userId);
  }

  function joinServer(userId, code) {
    const server = serverByInvite(code);
    if (!server) throw new Error("Invalid invite code.");
    if (server.members[userId]) return server;
    server.members[userId] = { role: "member", joinedAt: Date.now(), roles: [] };
    for (const ch of server.channels) {
      ch.readBy = ch.readBy || {};
      ch.readBy[userId] = Date.now();
    }
    save();
    return server;
  }

  function leaveServer(userId, serverId) {
    const s = db.servers[serverId];
    if (!s || !s.members[userId]) return;
    delete s.members[userId];
    for (const ch of s.channels) {
      if (ch.readBy) delete ch.readBy[userId];
      if (ch.voiceUsers) ch.voiceUsers = ch.voiceUsers.filter(id => id !== userId);
    }
    const remaining = Object.keys(s.members);
    if (remaining.length === 0) {
      delete db.servers[serverId];
    } else if (s.ownerId === userId) {
      s.ownerId = remaining[0];
      s.members[s.ownerId].role = "owner";
    }
    save();
  }

  function deleteServer(userId, serverId) {
    const s = db.servers[serverId];
    if (!s || s.ownerId !== userId) throw new Error("Only the owner can delete this server.");
    delete db.servers[serverId];
    save();
  }

  function updateServer(userId, serverId, patch) {
    const s = db.servers[serverId];
    if (!s || !canManageServer(serverId, userId)) throw new Error("You don't have permission.");
    if (patch.name !== undefined) s.name = String(patch.name).trim().slice(0, 100) || s.name;
    if (patch.icon !== undefined) {
      const icon = String(patch.icon);
      s.icon = icon.startsWith("data:image/") ? icon.slice(0, 400000) : icon.slice(0, 8);
    }
    if (patch.topic !== undefined && s.channels[0]) s.channels[0].topic = String(patch.topic).slice(0, 200);
    save();
    return s;
  }

  function regenerateInvite(userId, serverId) {
    const s = db.servers[serverId];
    if (!s || !canManageServer(serverId, userId)) throw new Error("You don't have permission.");
    s.inviteCode = uniqueInvite();
    save();
    return s.inviteCode;
  }

  function addChannel(userId, serverId, data = {}) {
    const s = db.servers[serverId];
    if (!s || !canManageChannels(serverId, userId)) throw new Error("You don't have permission.");
    const name = (data.name || "new-channel").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "").slice(0, 40);
    if (!name) throw new Error("Channel name is required.");
    if (s.channels.some(c => c.name === name && c.type === (data.type || "text"))) throw new Error("Channel already exists.");
    const categoryId = s.categories.some(c => c.id === data.categoryId) ? data.categoryId : (s.categories[0] ? s.categories[0].id : null);
    const ch = {
      id: Utils.uid("channel"),
      name,
      type: data.type === "voice" ? "voice" : "text",
      categoryId,
      topic: (data.topic || "").slice(0, 200),
      position: s.channels.length,
      messages: [],
      readBy: {},
      voiceUsers: data.type === "voice" ? [] : undefined
    };
    if (ch.type === "text") delete ch.voiceUsers;
    for (const uid in s.members) ch.readBy[uid] = Date.now();
    s.channels.push(ch);
    save();
    return ch;
  }

  function updateChannel(userId, serverId, channelId, patch) {
    const s = db.servers[serverId];
    const ch = s && s.channels.find(c => c.id === channelId);
    if (!s || !ch || !canManageChannels(serverId, userId)) throw new Error("You don't have permission.");
    if (patch.name !== undefined) {
      const name = String(patch.name).trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-_]/g, "").slice(0, 40);
      if (name) ch.name = name;
    }
    if (patch.topic !== undefined) ch.topic = String(patch.topic).slice(0, 200);
    if (patch.categoryId !== undefined && s.categories.some(c => c.id === patch.categoryId)) ch.categoryId = patch.categoryId;
    save();
    return ch;
  }

  function deleteChannel(userId, serverId, channelId) {
    const s = db.servers[serverId];
    const idx = s ? s.channels.findIndex(c => c.id === channelId) : -1;
    if (!s || idx === -1 || !canManageChannels(serverId, userId)) throw new Error("You don't have permission.");
    if (s.channels.length <= 1) throw new Error("A server needs at least one channel.");
    const ch = s.channels[idx];
    if (ch.type === "text" && !s.channels.some(c => c.type === "text" && c.id !== channelId)) {
      throw new Error("A server needs at least one text channel.");
    }
    s.channels.splice(idx, 1);
    save();
    return true;
  }

  /* ---------- categories ---------- */

  function addCategory(userId, serverId, data = {}) {
    const s = db.servers[serverId];
    if (!s || !canManageChannels(serverId, userId)) throw new Error("You don't have permission.");
    const name = (data.name || "New Category").trim().slice(0, 50) || "New Category";
    const cat = {
      id: Utils.uid("cat"),
      name,
      position: (s.categories.reduce((m, c) => Math.max(m, c.position || 0), -1)) + 1,
      collapsed: false
    };
    s.categories.push(cat);
    s.categories.sort((a, b) => (a.position || 0) - (b.position || 0));
    save();
    return cat;
  }

  function updateCategory(userId, serverId, catId, patch) {
    const s = db.servers[serverId];
    const cat = s && s.categories.find(c => c.id === catId);
    if (!s || !cat || !canManageChannels(serverId, userId)) throw new Error("You don't have permission.");
    if (patch.name !== undefined) cat.name = String(patch.name).trim().slice(0, 50) || cat.name;
    if (patch.collapsed !== undefined) cat.collapsed = !!patch.collapsed;
    save();
    return cat;
  }

  function deleteCategory(userId, serverId, catId) {
    const s = db.servers[serverId];
    const cat = s && s.categories.find(c => c.id === catId);
    if (!s || !cat || !canManageChannels(serverId, userId)) throw new Error("You don't have permission.");
    const remaining = s.categories.filter(c => c.id !== catId);
    let fallback = remaining[0];
    if (!fallback) {
      fallback = { id: Utils.uid("cat"), name: "General", position: 0, collapsed: false };
      remaining.push(fallback);
    }
    for (const ch of s.channels) if (ch.categoryId === catId) ch.categoryId = fallback.id;
    s.categories = remaining;
    save();
    return true;
  }

  function reorderLayout(userId, serverId, layout = {}) {
    const s = db.servers[serverId];
    if (!s || !canManageChannels(serverId, userId)) throw new Error("You don't have permission.");
    const cats = s.categories || [];
    const catIds = new Set(cats.map(c => c.id));
    if (Array.isArray(layout.categories)) {
      const order = layout.categories.filter(id => catIds.has(id));
      for (const c of cats) if (!order.includes(c.id)) order.push(c.id);
      order.forEach((id, i) => { const c = cats.find(x => x.id === id); if (c) c.position = i; });
      cats.sort((a, b) => (a.position || 0) - (b.position || 0));
    }
    if (layout.channels && typeof layout.channels === "object") {
      const chById = {};
      for (const ch of s.channels) chById[ch.id] = ch;
      for (const [catId, ids] of Object.entries(layout.channels)) {
        if (!Array.isArray(ids)) continue;
        const valid = catId === "__other" || catIds.has(catId);
        if (!valid) continue;
        ids.forEach((chId, i) => {
          const ch = chById[chId];
          if (!ch) return;
          if (catId !== "__other") ch.categoryId = catId;
          ch.position = i;
        });
      }
    }
    save();
    return s;
  }

  /* ---------- roles ---------- */

  const ROLE_PERMISSIONS = ["manageChannels", "manageMessages", "manageRoles", "kickMembers", "manageServer"];

  function cleanPermissions(input) {
    const p = {};
    for (const k of ROLE_PERMISSIONS) p[k] = !!(input && input[k]);
    return p;
  }

  function addRole(userId, serverId, data = {}) {
    const s = db.servers[serverId];
    if (!s || !canManageRoles(serverId, userId)) throw new Error("You don't have permission.");
    const name = (data.name || "New Role").trim().slice(0, 50) || "New Role";
    const role = {
      id: Utils.uid("role"),
      name,
      color: data.color || "#5865f2",
      position: (s.roles.reduce((m, r) => Math.max(m, r.position || 0), -1)) + 1,
      permissions: cleanPermissions(data.permissions || data)
    };
    s.roles.push(role);
    save();
    return role;
  }

  function updateRole(userId, serverId, roleId, patch) {
    const s = db.servers[serverId];
    const role = s && s.roles.find(r => r.id === roleId);
    if (!s || !role || !canManageRoles(serverId, userId)) throw new Error("You don't have permission.");
    if (patch.name !== undefined) role.name = String(patch.name).trim().slice(0, 50) || role.name;
    if (patch.color !== undefined) role.color = String(patch.color).slice(0, 20);
    if (patch.permissions !== undefined) role.permissions = cleanPermissions(patch.permissions);
    save();
    return role;
  }

  function deleteRole(userId, serverId, roleId) {
    const s = db.servers[serverId];
    const role = s && s.roles.find(r => r.id === roleId);
    if (!s || !role || !canManageRoles(serverId, userId)) throw new Error("You don't have permission.");
    s.roles = s.roles.filter(r => r.id !== roleId);
    for (const uid in s.members) {
      s.members[uid].roles = (s.members[uid].roles || []).filter(id => id !== roleId);
    }
    save();
    return true;
  }

  function setMemberRoles(ownerId, serverId, memberId, roleIds) {
    const s = db.servers[serverId];
    if (!s || s.ownerId !== ownerId) throw new Error("Only the owner can assign roles.");
    if (!s.members[memberId]) throw new Error("Member not found.");
    const valid = new Set(s.roles.map(r => r.id));
    s.members[memberId].roles = (roleIds || []).filter(id => valid.has(id));
    save();
    return true;
  }

  function kickMember(userId, serverId, targetId) {
    const s = db.servers[serverId];
    if (!s || !s.members[userId] || !s.members[targetId]) throw new Error("You don't have permission.");
    if (!canKickMembers(serverId, userId)) throw new Error("You don't have permission.");
    if (targetId === s.ownerId) throw new Error("You can't kick the owner.");
    const actorIsOwner = s.ownerId === userId || s.members[userId].role === "owner";
    const targetRole = s.members[targetId].role;
    if (!actorIsOwner && (targetRole === "admin" || targetRole === "owner")) throw new Error("You can't kick that member.");
    leaveServer(targetId, serverId);
    return true;
  }

  function setMemberRole(userId, serverId, targetId, role) {
    const s = db.servers[serverId];
    if (!s || s.ownerId !== userId || !s.members[targetId]) throw new Error("Only the owner can change roles.");
    if (targetId === userId) throw new Error("You can't change your own role.");
    s.members[targetId].role = role === "admin" ? "admin" : "member";
    save();
    return true;
  }

  function joinVoice(userId, serverId, channelId) {
    const s = db.servers[serverId];
    const ch = s && s.channels.find(c => c.id === channelId && c.type === "voice");
    if (!ch || !isMember(serverId, userId)) throw new Error("Voice channel not found.");
    for (const c of s.channels) if (c.voiceUsers) c.voiceUsers = c.voiceUsers.filter(id => id !== userId);
    if (!ch.voiceUsers) ch.voiceUsers = [];
    if (!ch.voiceUsers.includes(userId)) ch.voiceUsers.push(userId);
    save();
    return ch;
  }

  function leaveVoice(userId, serverId, channelId) {
    const s = db.servers[serverId];
    const ch = s && s.channels.find(c => c.id === channelId);
    if (ch && ch.voiceUsers) {
      ch.voiceUsers = ch.voiceUsers.filter(id => id !== userId);
      save();
    }
  }

  function voiceChannelFor(userId, serverId) {
    const s = db.servers[serverId];
    if (!s) return null;
    return s.channels.find(c => c.type === "voice" && c.voiceUsers && c.voiceUsers.includes(userId)) || null;
  }

  /* ---------- containers / messages ---------- */

  function containerForView(view) {
    if (!view) return null;
    if (view.type === "dm") return db.dms[view.id] || null;
    const s = db.servers[view.serverId];
    if (!s) return null;
    return s.channels.find(c => c.id === view.channelId) || null;
  }

  function unreadCount(container, userId) {
    if (!container || !container.messages) return 0;
    const lastRead = (container.readBy && container.readBy[userId]) || 0;
    let count = 0;
    for (const m of container.messages) {
      if (m.ts > lastRead && m.authorId !== userId && !m.deleted) count++;
    }
    return count;
  }

  function markRead(container, userId) {
    if (!container) return;
    container.readBy = container.readBy || {};
    container.readBy[userId] = Date.now();
    save();
  }

  function markUnread(container, userId) {
    if (!container) return;
    container.readBy = container.readBy || {};
    let latest = 0;
    for (const m of container.messages || []) {
      if (!m.deleted && m.authorId !== userId && m.ts > latest) latest = m.ts;
    }
    container.readBy[userId] = latest ? latest - 1 : 0;
    save();
  }

  function sendMessage(container, userId, content, attachments = [], extra = {}) {
    if (!container || !container.messages) throw new Error("Channel not found.");
    content = (content || "").slice(0, 2000);
    attachments = (attachments || []).slice(0, 5);
    const poll = extra.poll ? normalizePoll(extra.poll) : null;
    if (!content.trim() && attachments.length === 0 && !poll) return null;
    const msg = {
      id: Utils.uid("msg"),
      authorId: userId,
      content,
      ts: Date.now(),
      attachments,
      reactions: {},
      edited: false,
      deleted: false
    };
    if (extra.replyTo) {
      const target = findMessage(container, extra.replyTo);
      if (target && !target.deleted) msg.replyTo = target.id;
    }
    if (poll) msg.poll = poll;
    container.messages.push(msg);
    if (container.messages.length > 500) container.messages = container.messages.slice(-500);
    save();
    return msg;
  }

  function normalizePoll(p) {
    const question = String(p.question || "").trim().slice(0, 200);
    const options = (p.options || []).map(o => String(o).trim().slice(0, 100)).filter(Boolean).slice(0, 10);
    if (!question || options.length < 2) return null;
    return { question, options: options.map(text => ({ text, votes: [] })), multiple: !!p.multiple };
  }

  function togglePollVote(container, userId, messageId, optionIndex) {
    const msg = findMessage(container, messageId);
    if (!msg || msg.deleted || !msg.poll) throw new Error("Poll not found.");
    const opt = msg.poll.options[optionIndex];
    if (!opt) return msg;
    const has = opt.votes.includes(userId);
    if (!msg.poll.multiple) {
      for (const o of msg.poll.options) {
        const i = o.votes.indexOf(userId);
        if (i >= 0) o.votes.splice(i, 1);
      }
      if (!has) opt.votes.push(userId);
    } else if (has) {
      opt.votes.splice(opt.votes.indexOf(userId), 1);
    } else {
      opt.votes.push(userId);
    }
    save();
    return msg;
  }

  function findMessage(container, messageId) {
    if (!container || !container.messages) return null;
    return container.messages.find(m => m.id === messageId) || null;
  }

  function canModerateMessage(serverId, userId, msg) {
    if (!serverId) return false;
    if (!msg || msg.authorId === userId) return true;
    return canManageMessages(serverId, userId);
  }

  function editMessage(container, userId, messageId, content) {
    const msg = findMessage(container, messageId);
    if (!msg || msg.deleted) throw new Error("Message not found.");
    if (msg.authorId !== userId) throw new Error("You can only edit your own messages.");
    msg.content = (content || "").slice(0, 2000);
    msg.edited = true;
    msg.ts = Date.now();
    save();
    return msg;
  }

  function deleteMessage(container, userId, messageId, serverId = null) {
    const msg = findMessage(container, messageId);
    if (!msg || msg.deleted) return false;
    if (msg.authorId !== userId && !canModerateMessage(serverId, userId, msg)) {
      throw new Error("You can't delete that message.");
    }
    msg.deleted = true;
    msg.content = "";
    msg.attachments = [];
    msg.reactions = {};
    save();
    return true;
  }

  function toggleReaction(container, userId, messageId, emoji) {
    const msg = findMessage(container, messageId);
    if (!msg || msg.deleted) throw new Error("Message not found.");
    msg.reactions = msg.reactions || {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    const idx = msg.reactions[emoji].indexOf(userId);
    if (idx >= 0) msg.reactions[emoji].splice(idx, 1);
    else msg.reactions[emoji].push(userId);
    if (msg.reactions[emoji].length === 0) delete msg.reactions[emoji];
    save();
    return msg;
  }

  function pinMessage(container, userId, messageId, serverId = null) {
    const msg = findMessage(container, messageId);
    if (!msg || msg.deleted) return false;
    if (msg.authorId !== userId && !canModerateMessage(serverId, userId, msg)) {
      throw new Error("You can't pin that message.");
    }
    msg.pinned = !msg.pinned;
    save();
    return msg.pinned;
  }

  /* ---------- profile / settings ---------- */

  function updateProfile(userId, patch) {
    const u = db.users[userId];
    if (!u) return null;
    if (patch.displayName !== undefined) u.displayName = String(patch.displayName).trim().slice(0, 64) || u.displayName;
    if (patch.username !== undefined) {
      const username = String(patch.username).trim();
      if (username.length < 3 || username.length > 32) throw new Error("Username must be 3-32 characters.");
      if (!/^[a-zA-Z0-9_.-]+$/.test(username)) throw new Error("Invalid username.");
      const key = username.toLowerCase();
      if (db.usernames[key] && db.usernames[key] !== userId) throw new Error("Username taken.");
      delete db.usernames[u.username.toLowerCase()];
      u.username = username;
      db.usernames[key] = userId;
    }
    if (patch.avatar !== undefined) u.avatar = patch.avatar;
    if (patch.bio !== undefined) u.bio = String(patch.bio).slice(0, 300);
    if (patch.status !== undefined) {
      u.status = ["online", "idle", "dnd", "invisible"].includes(patch.status) ? patch.status : "online";
      if (db.presence[userId]) db.presence[userId].status = u.status;
    }
    save();
    return u;
  }

  function changePassword(userId, oldPassword, newPassword) {
    const u = db.users[userId];
    if (!u) throw new Error("User not found.");
    return hashPassword(oldPassword, u.salt).then(hash => {
      if (hash !== u.passwordHash) throw new Error("Current password is incorrect.");
      if ((newPassword || "").length < 4) throw new Error("New password must be at least 4 characters.");
      return hashPassword(newPassword, u.salt).then(h => {
        u.passwordHash = h;
        save();
      });
    });
  }

  function updateSettings(patch) {
    db.settings = Object.assign({}, db.settings, patch || {});
    applySettings();
    save();
  }

  function applySettings() {
    const s = db.settings || {};
    document.documentElement.dataset.theme = s.theme === "light" ? "light" : "dark";
    document.documentElement.style.setProperty("--accent", s.accent || "#5865f2");
  }

  function resetAll() {
    try { localStorage.removeItem(DB_KEY); } catch (e) {}
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    location.reload();
  }

  return {
    initSync, onState, get db() { return db; }, session: () => session,
    currentUser, isLoggedIn, signup, login, logout, setSession, clearSession,
    setOnline, touchPresence, isOnline, effectiveStatus,
    getUser, userByUsername, friendStatus, friendMap, friendIds, friendList,
    pendingIncoming, pendingOutgoing, areFriends, friendRequest, respondFriend,
    removeFriend, blockUser, unblockUser, canDM,
    getDMId, ensureDM, dmFor, dmList,
    createServer, serverByInvite, getServer, isMember, memberRole, canManageServer,
    permissions, canManageChannels, canManageMessages, canManageRoles, canKickMembers,
    memberCustomRoles, memberRoleColor, memberRoleList,
    joinServer, leaveServer, deleteServer, updateServer, regenerateInvite,
    addChannel, updateChannel, deleteChannel, addCategory, updateCategory, deleteCategory, reorderLayout,
    addRole, updateRole, deleteRole, setMemberRoles,
    kickMember, setMemberRole,
    joinVoice, leaveVoice, voiceChannelFor,
    containerForView, unreadCount, markRead, markUnread, sendMessage, findMessage,
    togglePollVote,
    canModerateMessage, editMessage, deleteMessage, toggleReaction, pinMessage,
    updateProfile, changePassword, updateSettings, applySettings, resetAll,
    loadRemote, hashPassword
  };
})();
