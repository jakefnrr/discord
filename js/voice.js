"use strict";

/* WebRTC voice/video for voice channels.
   Signaling goes over BroadcastChannel, so it works between tabs of this
   same browser profile (same as the rest of the clone's sync). */
const Voice = (() => {
  let localStream = null;   // microphone
  let camStream = null;     // camera
  let peers = new Map();    // userId -> { pc, stream, makingOffer, polite }
  let micMuted = false;
  let camOn = false;
  let deafened = false;
  let sigBC = null;
  let joined = false;

  const me = () => Store.currentUser() && Store.currentUser().id;
  const uid = () => me();

  function room() {
    const id = uid();
    if (!id) return null;
    for (const sid in Store.db.servers) {
      const s = Store.db.servers[sid];
      if (!s) continue;
      const ch = s.channels.find(c => c.type === "voice" && c.voiceUsers && c.voiceUsers.includes(id));
      if (ch) return { serverId: sid, channelId: ch.id, members: ch.voiceUsers.filter(x => x !== id) };
    }
    return null;
  }

  function init() {
    try {
      sigBC = new BroadcastChannel("dc-voice-signal");
      sigBC.onmessage = e => { try { onSignal(e.data); } catch (err) { console.warn("voice sig", err); } };
    } catch (e) {}
    window.addEventListener("beforeunload", () => { try { teardown(); } catch (_) {} });
  }

  function sendSignal(to, payload) {
    try { sigBC && sigBC.postMessage(Object.assign({ to }, payload)); } catch (e) {}
  }

  function ensureMic() {
    if (localStream) return Promise.resolve(localStream);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.resolve(null);
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then(s => {
        localStream = s;
        applyMicState();
        for (const [, p] of peers) {
          s.getTracks().forEach(t => { if (!p.pc.getSenders().some(x => x.track === t)) p.pc.addTrack(t, s); });
        }
        return s;
      })
      .catch(() => null);
  }

  function applyMicState() {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(t => { t.enabled = !micMuted && !deafened; });
  }

  function sync() {
    const r = room();
    if (!r) { if (joined || peers.size) leave(); return; }
    joined = true;
    ensureMic().then(() => {
      for (const pid of r.members) ensurePeer(pid);
      for (const [pid] of peers) if (!r.members.includes(pid)) closePeer(pid);
      renderGrid();
    });
  }

  function leave() {
    for (const pid of [...peers.keys()]) closePeer(pid);
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
    camOn = false;
    joined = false;
    renderGrid();
  }

  function teardown() { leave(); }

  function setMicMuted(m) { micMuted = !!m; applyMicState(); }
  function setDeafened(d) {
    deafened = !!d;
    applyMicState();
    document.querySelectorAll("#voice-grid audio, #voice-grid video").forEach(el => { el.muted = deafened; });
  }
  function isCameraOn() { return camOn; }

  async function toggleCamera() {
    if (camOn) {
      if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
      for (const [, p] of peers) {
        const sender = p.pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (sender) sender.replaceTrack(null).catch(() => {});
      }
      camOn = false;
    } else {
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } });
        camOn = true;
        for (const [, p] of peers) {
          const track = camStream.getVideoTracks()[0];
          const sender = p.pc.getSenders().find(s => s.track && s.track.kind === "video");
          if (sender) sender.replaceTrack(track).catch(() => {});
          else p.pc.addTrack(track, camStream);
        }
        triggerNegotiateAll();
      } catch (e) {
        UI.toast("Camera unavailable or permission denied", "error");
        camStream = null;
        camOn = false;
      }
    }
    renderGrid();
    return camOn;
  }

  function triggerNegotiateAll() {
    for (const [pid, p] of peers) {
      if (offerer(pid) === uid()) negotiate(pid, p);
    }
  }

  function offerer(a, b) { return a < b ? a : b; }

  function ensurePeer(pid) {
    if (peers.has(pid)) return;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });
    const p = { pc, stream: null, makingOffer: false, polite: uid() > pid };
    peers.set(pid, p);
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    if (camStream) camStream.getTracks().forEach(t => pc.addTrack(t, camStream));

    pc.onnegotiationneeded = async () => {
      if (offerer(uid(), pid) !== uid()) return; // only the smaller id offers
      await negotiate(pid, p);
    };
    pc.onicecandidate = e => {
      if (e.candidate) sendSignal(pid, { t: "sig", kind: "cand", data: e.candidate.toJSON() });
    };
    pc.ontrack = e => {
      p.stream = p.stream || new MediaStream();
      e.streams.forEach(s => s.getTracks().forEach(tr => { if (!p.stream.getTracks().some(x => x.id === tr.id)) p.stream.addTrack(tr); }));
      if (e.streams[0]) p.stream = e.streams[0];
      renderGrid();
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        // keep the peer; it may recover. Only drop on explicit leave.
      }
      renderGrid();
    };
    if (localStream) negotiate(pid, p);
  }

  async function negotiate(pid, p) {
    try {
      p.makingOffer = true;
      await p.pc.setLocalDescription();
      sendSignal(pid, { t: "sig", kind: "offer", data: p.pc.localDescription });
    } catch (e) {} finally { p.makingOffer = false; }
  }

  function closePeer(pid) {
    const p = peers.get(pid);
    if (p) { try { p.pc.close(); } catch (e) {} peers.delete(pid); }
    renderGrid();
  }

  async function onSignal(msg) {
    if (!msg || !msg.from || msg.from === uid()) return;
    if (msg.t === "sig") {
      const r = room();
      if (!r || !r.members.includes(msg.from)) return;
      const p = peers.get(msg.from) || (ensurePeerFromSignal(msg.from), peers.get(msg.from));
      if (!p) return;
      const d = msg.data;
      try {
        if (d.type === "offer") {
          const collision = p.makingOffer || p.pc.signalingState !== "stable";
          const ignore = !p.polite && collision;
          if (ignore) return;
          await p.pc.setRemoteDescription(d);
          await p.pc.setLocalDescription();
          sendSignal(msg.from, { t: "sig", kind: "answer", data: p.pc.localDescription });
        } else if (d.type === "answer") {
          if (p.makingOffer || p.pc.signalingState !== "have-local-offer") return;
          await p.pc.setRemoteDescription(d);
        } else if (d.type === "candidate" || (d && d.candidate !== undefined)) {
          try { await p.pc.addIceCandidate(d); } catch (e) {}
        }
      } catch (e) { console.warn("voice negotiate", e); }
      return;
    }
  }

  function ensurePeerFromSignal(pid) {
    // Only accept signals from people in our current room.
    const r = room();
    if (!r || !r.members.includes(pid)) return;
    ensurePeer(pid);
  }

  /* ---------- remote media grid ---------- */

  function participantInfo(pid) {
    for (const sid in Store.db.servers) {
      const s = Store.db.servers[sid];
      if (!s) continue;
      const m = s.members && s.members[pid];
      if (m) {
        const u = Store.getUser(pid);
        return u ? (u.displayName || u.username) : "Unknown";
      }
    }
    const u = Store.getUser(pid);
    return u ? (u.displayName || u.username) : "Unknown";
  }

  let lastGridSig = "";

  function renderGrid() {
    const grid = document.getElementById("voice-grid");
    if (!grid) return;
    const r = room();
    const meId = uid();
    if (!r || !meId) { if (grid.childElementCount) { grid.innerHTML = ""; grid.style.display = "none"; } lastGridSig = ""; return; }
    // signature: membership + per-peer stream/video state + own AV state
    const sig = r.members.slice().sort().join(",") + "|" + camOn + "|" + micMuted + "|" + deafened + "|" +
      r.members.map(pid => {
        const p = peers.get(pid);
        return pid + ":" + (p && p.stream ? (p.stream.getVideoTracks().length ? "v" : "a") : "-");
      }).join(",");
    if (sig === lastGridSig && grid.childElementCount) return;
    lastGridSig = sig;
    let html = "";
    // self tile
    html += `<div class="voice-tile self">
      ${camStream ? `<video autoplay playsinline muted class="voice-video"></video>` : `<div class="voice-avatar">${Utils.esc(Utils.initials((Store.getUser(meId) || {}).displayName || "Me"))}</div>`}
      <div class="voice-tile-name">${Utils.esc((Store.getUser(meId) || {}).displayName || "You")}${micMuted || deafened ? " 🔇" : ""}</div>
    </div>`;
    for (const pid of r.members) {
      const p = peers.get(pid);
      const hasVideo = p && p.stream && p.stream.getVideoTracks().some(t => t.readyState === "live" && t.enabled !== false);
      html += `<div class="voice-tile" data-voice-user="${pid}">
        ${hasVideo ? `<video autoplay playsinline class="voice-video" muted></video>` : `<div class="voice-avatar">${Utils.esc(Utils.initials(participantInfo(pid)))}</div>`}
        <div class="voice-tile-name">${Utils.esc(participantInfo(pid))}</div>
      </div>`;
    }
    const wasEmpty = grid.childElementCount === 0;
    grid.innerHTML = html;
    grid.style.display = "flex";
    // attach streams
    if (camStream) {
      const v = grid.querySelector(".voice-tile.self .voice-video");
      if (v) v.srcObject = camStream;
    }
    for (const pid of r.members) {
      const p = peers.get(pid);
      if (!p || !p.stream) continue;
      const tile = grid.querySelector(`[data-voice-user="${pid}"]`);
      if (!tile) continue;
      const vid = tile.querySelector(".voice-video");
      const hasVid = p.stream.getVideoTracks().length > 0;
      if (hasVid && vid) { vid.srcObject = p.stream; vid.muted = deafened; }
      else {
        let a = tile.querySelector("audio.voice-audio");
        if (!a) { a = document.createElement("audio"); a.autoplay = true; a.className = "voice-audio"; a.muted = deafened; tile.appendChild(a); }
        a.srcObject = p.stream;
      }
    }
    if (wasEmpty) { /* streams attach above */ }
  }

  // Re-render grid periodically while in a call (cheap; keeps names/streams fresh)
  setInterval(() => { try { renderGrid(); } catch (e) {} }, 3000);

  return { init, sync, leave, teardown, setMicMuted, setDeafened, toggleCamera, isCameraOn, room };
})();
