export interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket endpoint
    if (url.pathname === "/ws") {
      const roomId = url.searchParams.get("room") || "default";
      const id = env.GAME_ROOM.idFromName(roomId);
      const room = env.GAME_ROOM.get(id);
      return room.fetch(request);
    }

    // Let assets handle other requests
    return new Response("Not found", { status: 404 });
  },
};

interface PlayerData {
  x: number;
  y: number;
  hue: number;
  facingRight: boolean;
}

export class GameRoom {
  state: DurableObjectState;
  players: Map<WebSocket, { id: string; data: PlayerData | null }>;
  nextId: number;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.players = new Map();
    this.nextId = 1;
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const playerId = `player_${this.nextId++}`;
    this.players.set(server, { id: playerId, data: null });

    server.accept();

    // Send init message with current players
    const currentPlayers: Record<string, PlayerData> = {};
    for (const [ws, player] of this.players) {
      if (ws !== server && player.data) {
        currentPlayers[player.id] = player.data;
      }
    }

    server.send(JSON.stringify({
      type: "init",
      yourId: playerId,
      players: currentPlayers
    }));

    // Notify others of new player
    this.broadcast(JSON.stringify({
      type: "player_joined",
      id: playerId
    }), server);

    server.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data as string);

        if (data.type === "update") {
          const player = this.players.get(server);
          if (player) {
            player.data = {
              x: data.x,
              y: data.y,
              hue: data.hue,
              facingRight: data.facingRight
            };

            // Broadcast to others
            this.broadcast(JSON.stringify({
              type: "player_update",
              id: player.id,
              ...player.data
            }), server);
          }
        }
      } catch (e) {
        console.error("Failed to parse message:", e);
      }
    });

    server.addEventListener("close", () => {
      const player = this.players.get(server);
      if (player) {
        this.broadcast(JSON.stringify({
          type: "player_left",
          id: player.id
        }), server);
      }
      this.players.delete(server);
    });

    server.addEventListener("error", () => {
      const player = this.players.get(server);
      if (player) {
        this.broadcast(JSON.stringify({
          type: "player_left",
          id: player.id
        }), server);
      }
      this.players.delete(server);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  broadcast(message: string, exclude?: WebSocket) {
    for (const [ws, _] of this.players) {
      if (ws !== exclude) {
        try {
          ws.send(message);
        } catch (e) {
          // Connection might be closed
        }
      }
    }
  }
}
