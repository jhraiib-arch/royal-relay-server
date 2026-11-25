const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const wss = new WebSocket.Server({ port: PORT });
const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, { host: null, controllers: new Set() });
  }
  return rooms.get(code);
}

function send(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

wss.on("connection", (ws) => {
  ws.role = null;
  ws.code = null;

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const code = String(data.code || ws.code || "").trim();

    if (data.type === "register_host" && code.length === 6) {
      ws.role = "host";
      ws.code = code;
      const room = getRoom(code);
      room.host = ws;
      send(ws, { type: "host_ready", code });
      for (const c of room.controllers) {
        send(c, { type: "host_online", code });
      }
    }

    if (data.type === "join_controller" && code.length === 6) {
      ws.role = "controller";
      ws.code = code;
      const room = getRoom(code);
      room.controllers.add(ws);
      const online = Boolean(room.host && room.host.readyState === WebSocket.OPEN);
      send(ws, { type: "linked", code, hostOnline: online });
      if (online) {
        send(room.host, { type: "controller_joined", code });
      }
    }

    if (data.type === "command" && code.length === 6) {
      const room = getRoom(code);
      if (room.host && room.host.readyState === WebSocket.OPEN) {
        send(room.host, { type: "command", code, cmd: data.cmd, time: Date.now() });
      } else {
        send(ws, { type: "error", message: "Host offline" });
      }
    }

    if (data.type === "reply" && code.length === 6) {
      const room = getRoom(code);
      for (const c of room.controllers) {
        send(c, { type: "reply", code, cmd: data.cmd, output: data.output });
      }
    }
  });

  ws.on("close", () => {
    if (!ws.code) return;
    const room = getRoom(ws.code);
    if (ws.role === "host" && room.host === ws) {
      room.host = null;
      for (const c of room.controllers) {
        send(c, { type: "host_offline", code: ws.code });
      }
    }
    if (ws.role === "controller") {
      room.controllers.delete(ws);
    }
  });
});

console.log("Server running on port", PORT);
