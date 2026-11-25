const http = require("http");
const WebSocket = require("ws");

const PORT = process.env.PORT || 10000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Royal Relay Server Running");
});

const wss = new WebSocket.Server({ server });

// প্রতিটি 6-digit কোডের জন্য Host ও Controller সকেট রাখা হবে
const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, { host: null, controller: null });
  }
  return rooms.get(code);
}

function safeSend(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

wss.on("connection", (ws) => {
  ws.role = null;
  ws.roomCode = null;

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch (err) {
      return;
    }

    if (!data || !data.type) return;

    // 1. Host রেজিস্টার
    if (data.type === "register_host" && data.code) {
      const code = String(data.code).trim();
      const room = getRoom(code);

      if (room.host && room.host !== ws && room.host.readyState === WebSocket.OPEN) {
        room.host.close(1000, "Replaced by new host");
      }

      room.host = ws;
      ws.role = "host";
      ws.roomCode = code;

      safeSend(ws, { type: "host_registered", code });

      if (room.controller && room.controller.readyState === WebSocket.OPEN) {
        safeSend(room.controller, { type: "host_online", code });
      }
      return;
    }

    // 2. Controller যুক্ত হওয়া
    if (data.type === "join_controller" && data.code) {
      const code = String(data.code).trim();
      const room = getRoom(code);

      if (room.controller && room.controller !== ws && room.controller.readyState === WebSocket.OPEN) {
        room.controller.close(1000, "Replaced by new controller");
      }

      room.controller = ws;
      ws.role = "controller";
      ws.roomCode = code;

      const hostOnline = Boolean(room.host && room.host.readyState === WebSocket.OPEN);
      safeSend(ws, { type: "linked", code, hostOnline });
      return;
    }

    // 3. Controller থেকে Host-এ কমান্ড পাঠানো
    if (data.type === "command" && data.code) {
      const code = String(data.code).trim();
      const room = getRoom(code);
      if (room.host && room.host.readyState === WebSocket.OPEN) {
        safeSend(room.host, {
          type: "command",
          code,
          cmd: data.cmd
        });
      } else {
        safeSend(ws, {
          type: "host_offline",
          code
        });
      }
      return;
    }

    // 4. Host থেকে Controller-এ রিপ্লাই পাঠানো
    if (data.type === "reply" && data.code) {
      const code = String(data.code).trim();
      const room = getRoom(code);
      if (room.controller && room.controller.readyState === WebSocket.OPEN) {
        safeSend(room.controller, {
          type: "reply",
          code,
          cmd: data.cmd,
          output: data.output
        });
      }
      return;
    }

    // 5. Host থেকে Controller-এ লাইভ স্ক্রিন ফ্রেম পাঠানো
    if (data.type === "screen_frame" && data.code && data.img) {
      const code = String(data.code).trim();
      const room = getRoom(code);
      if (room.controller && room.controller.readyState === WebSocket.OPEN) {
        safeSend(room.controller, {
          type: "screen_frame",
          code,
          img: data.img
        });
      }
    }
  });

  ws.on("close", () => {
    const code = ws.roomCode;
    if (!code || !rooms.has(code)) return;

    const room = rooms.get(code);

    if (ws.role === "host" && room.host === ws) {
      room.host = null;
      if (room.controller && room.controller.readyState === WebSocket.OPEN) {
        safeSend(room.controller, { type: "host_offline", code });
      }
    } else if (ws.role === "controller" && room.controller === ws) {
      room.controller = null;
    }

    if (!room.host && !room.controller) {
      rooms.delete(code);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Royal Relay Server listening on port ${PORT}`);
});
