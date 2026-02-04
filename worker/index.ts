export interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

const MAX_HEALTH = 4;
const SPAWN_X = 768; // WORLD_PIXELS / 2
const SPAWN_Y = 768;
const ATTACK_RANGE = 80; // Server-side validation range (slightly larger than client)

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      const roomId = url.searchParams.get("room") || "default";
      const id = env.GAME_ROOM.idFromName(roomId);
      const room = env.GAME_ROOM.get(id);
      return room.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
};

interface PlayerData {
  x: number;
  y: number;
  hue: number;
  facingRight: boolean;
  health: number;
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
        const player = this.players.get(server);
        if (!player) return;

        if (data.type === "update") {
          // Initialize health if new player
          const currentHealth = player.data?.health ?? MAX_HEALTH;

          player.data = {
            x: data.x,
            y: data.y,
            hue: data.hue,
            facingRight: data.facingRight,
            health: currentHealth
          };

          // Broadcast to others
          this.broadcast(JSON.stringify({
            type: "player_update",
            id: player.id,
            ...player.data
          }), server);
        }

        if (data.type === "attack") {
          const targetId = data.targetId;

          // Find target player
          let targetWs: WebSocket | null = null;
          let targetPlayer: { id: string; data: PlayerData | null } | null = null;

          for (const [ws, p] of this.players) {
            if (p.id === targetId) {
              targetWs = ws;
              targetPlayer = p;
              break;
            }
          }

          if (targetPlayer && targetPlayer.data && player.data) {
            // Validate attack range on server
            const dx = targetPlayer.data.x - player.data.x;
            const dy = targetPlayer.data.y - player.data.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist <= ATTACK_RANGE) {
              // Deal damage
              targetPlayer.data.health -= 1;
              const newHealth = targetPlayer.data.health;

              // Broadcast hit to all players
              this.broadcast(JSON.stringify({
                type: "hit",
                attackerId: player.id,
                targetId: targetId,
                newHealth: newHealth
              }));

              // If dead, respawn after a short delay
              if (newHealth <= 0) {
                targetPlayer.data.health = MAX_HEALTH;
                targetPlayer.data.x = SPAWN_X;
                targetPlayer.data.y = SPAWN_Y;

                // Broadcast respawn
                this.broadcast(JSON.stringify({
                  type: "respawn",
                  id: targetId,
                  x: SPAWN_X,
                  y: SPAWN_Y
                }));
              }
            }
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
