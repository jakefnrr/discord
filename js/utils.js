"use strict";

const Utils = (() => {
  const EMOJIS = [
    "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩",
    "😘","😗","😚","😙","🥲","😋","😛","😜","🤪","😝","🤑","🤗","🤭","🤫","🤔","🫡",
    "🤐","🤨","😐","😑","😶","🫥","😏","😒","🙄","😬","🤥","😌","😔","😪","🤤","😴",
    "😷","🤒","🤕","🤢","🤮","🥵","🥶","🥴","😵","🤯","🤠","🥳","🥸","😎","🤓","🧐",
    "😕","🫤","😟","🙁","😮","😯","😲","😳","🥺","🥹","😦","😧","😨","😰","😥","😢",
    "😭","😱","😖","😣","😞","😓","😩","😫","🥱","😤","😡","😠","🤬","😈","👿","💀",
    "☠️","💩","🤡","👹","👺","👻","👽","👾","🤖","🎃","😺","😸","😹","😻","😼","😽",
    "🙀","😿","😾","👍","👎","👏","🙌","👐","🤲","🤝","🙏","✌️","🤞","🤟","🤘","👌",
    "👈","👉","👆","👇","☝️","✋","🤚","🖐️","🖖","👋","🤙","💪","🦾","🖕","✍️","🫶",
    "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖",
    "💘","💝","💟","☮️","✝️","☪️","🕉️","☸️","✡️","🔯","🕎","☯️","☦️","🛐","⛎","♈",
    "♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓","🆔","⚛️","🉑","☢️","☣️","📴",
    "📳","🈶","🈚","🈸","🈺","🈷️","✴️","🆚","💮","🉐","㊙️","㊗️","🈴","🈵","🈹","🈲",
    "🅰️","🅱️","🆎","🆑","🅾️","🆘","❌","⭕","🛑","⛔","📛","🚫","💯","💢","♨️","🚷",
    "🚯","🚳","🚱","🔞","📵","🚭","❗","❕","❓","❔","‼️","⁉️","🔅","🔆","〽️","⚠️",
    "🚸","🔱","⚜️","🔰","♻️","✅","🈯","💹","❇️","✳️","❎","🌐","💠","Ⓜ️","🌀","💤",
    "🏧","🚾","♿","🅿️","🛗","🈳","🈂️","🛂","🛃","🛄","🛅","🚹","🚺","🚼","⚧️","🚻",
    "🚮","🎦","📶","🈁","🔣","ℹ️","🔤","🔡","🔠","🆖","🆗","🆙","🆒","🆕","🆓","0️⃣",
    "1️⃣","2️⃣","3️⃣","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟","🔢","#️⃣","*️⃣","⏏️","▶️","⏸️",
    "⏯️","⏹️","⏺️","⏭️","⏮️","⏩","⏪","⏫","⏬","◀️","🔼","🔽","➡️","⬅️","⬆️","⬇️",
    "↗️","↘️","↙️","↖️","↕️","↔️","↪️","↩️","⤴️","⤵️","🔀","🔁","🔂","🔄","🔃","🎵",
    "🎶","➕","➖","➗","✖️","🟰","♾️","💲","💱","™️","©️","®️","〰️","➰","➿","🔚",
    "🔙","🔛","🔝","🔜","✔️","☑️","🔘","🔴","🟠","🟡","🟢","🔵","🟣","⚫","⚪","🟤",
    "🔺","🔻","🔸","🔹","🔶","🔷","🔳","🔲","▪️","▫️","◾","◽","◼️","◻️","🟥","🟧",
    "🟨","🟩","🟦","🟪","⬛","⬜","🟫","🔈","🔇","🔉","🔊","🔔","🔕","📣","📢","👁️",
    "🗨️","🗯️","💬","💭","🗝️","🗣️","👤","👥","🫂","👣","🦶","🦵","💅","🤳","🫰","🫳",
    "🫴","🫵","🫱","🫲","🫳","🫴","🧠","🫀","🫁","🦷","🦴","👀","👁️","👅","👄","🫦"
  ];

  const COLORS = [
    "#5865f2", "#eb459e", "#ed4245", "#f26522", "#f0b232", "#57f287",
    "#1abc9c", "#2ecc71", "#3498db", "#9b59b6", "#e91e63", "#795548"
  ];

  function uid(prefix = "id") {
    return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
  }

  function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  function initials(name) {
    const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
  }

  function hashColor(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return COLORS[h % COLORS.length];
  }

  function colorFromUser(user) {
    if (!user) return "var(--accent)";
    if (user.avatar && user.avatar.type === "color") return user.avatar.value;
    return hashColor(user.username || user.id || "user");
  }

  function avatarHtml(user, opts = {}) {
    if (!user) user = { username: "?", displayName: "?", avatar: null };
    const size = opts.size || 40;
    const avatar = user.avatar || {};
    let inner = "";
    if (avatar.type === "emoji" && avatar.value) {
      inner = `<span class="avatar emoji-avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.55)}px">${esc(avatar.value)}</span>`;
    } else {
      const label = avatar.type === "initials" && avatar.value ? avatar.value : initials(user.displayName || user.username);
      inner = `<span class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px;background:${colorFromUser(user)}">${esc(label)}</span>`;
    }
    if (opts.status !== false) {
      const status = (opts.statusValue || user.status || "online");
      inner = `<span class="avatar-wrap" style="width:${size}px;height:${size}px">${inner}<span class="status-dot ${esc(status)}"></span></span>`;
    }
    return inner;
  }

  function fmtTime(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function fmtDay(ts) {
    const d = new Date(ts);
    const now = new Date();
    const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const diff = startOfDay(now) - startOfDay(d);
    if (diff === 0) return "Today";
    if (diff === 86400000) return "Yesterday";
    return d.toLocaleDateString([], { month: "short", day: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24);
    if (d < 7) return d + "d ago";
    return new Date(ts).toLocaleDateString();
  }

  function fmtBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + " " + units[i];
  }

  function randomInvite() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let out = "";
    for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  function throttle(fn, ms) {
    let last = 0;
    let timer;
    return (...args) => {
      const now = Date.now();
      const wait = ms - (now - last);
      if (wait <= 0) { last = now; fn(...args); }
      else if (!timer) {
        timer = setTimeout(() => { last = Date.now(); timer = null; fn(...args); }, wait);
      }
    };
  }

  function md(text, usersByName) {
    let s = esc(text || "");
    // code blocks first
    s = s.replace(/```([\s\S]*?)```/g, (m, code) => `<pre><code>${code.replace(/\n$/, "")}</code></pre>`);
    // inline code
    s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    // bold
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    // underline
    s = s.replace(/__([^_]+)__/g, "<u>$1</u>");
    // italic (simple, avoid matching bold leftovers)
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    // strikethrough
    s = s.replace(/~~([^~]+)~~/g, "<s>$1</s>");
    // links
    s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    // mentions
    if (usersByName) {
      for (const uname of Object.keys(usersByName)) {
        const re = new RegExp("@" + uname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
        s = s.replace(re, (m) => `<span class="mention">${m}</span>`);
      }
      s = s.replace(/@everyone\b/gi, '<span class="mention">@everyone</span>');
    }
    return s;
  }

  function usernamesMap(db) {
    const map = {};
    for (const id in db.users) {
      const u = db.users[id];
      if (u.username) map[u.username.toLowerCase()] = u;
    }
    return map;
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return {
    EMOJIS, COLORS, uid, esc, initials, hashColor, colorFromUser, avatarHtml,
    fmtTime, fmtDay, timeAgo, fmtBytes, randomInvite, debounce, throttle, md,
    usernamesMap, readFileAsDataURL, download
  };
})();
