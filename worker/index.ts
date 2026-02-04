export interface Env {
  GAME_ROOM: DurableObjectNamespace;
}

const MAX_HEALTH = 4;
const SPAWN_X = 768;
const SPAWN_Y = 768;

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
  kills: number;
  deaths: number;
  spellUses: { missile: number; dash: number; fireball: number; punch: number };
  lastSeen: number;
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

    // Send init with current players
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

    this.broadcast(JSON.stringify({ type: "player_joined", id: playerId }), server);

    server.addEventListener("message", (event) => {
      try {
        const data = JSON.parse(event.data as string);
        const player = this.players.get(server);
        if (!player) return;

        if (data.type === "update") {
          const prev = player.data;
          player.data = {
            x: data.x,
            y: data.y,
            hue: data.hue,
            facingRight: data.facingRight,
            health: prev?.health ?? MAX_HEALTH,
            kills: prev?.kills ?? 0,
            deaths: prev?.deaths ?? 0,
            spellUses: prev?.spellUses ?? { missile: 0, dash: 0, fireball: 0, punch: 0 },
            lastSeen: Date.now()
          };

          // Clean up stale players (not seen in 5 seconds)
          this.cleanupStalePlayers();

          this.broadcast(JSON.stringify({
            type: "player_update",
            id: player.id,
            ...player.data
          }), server);
        }

        if (data.type === "attack") {
          const targetId = data.targetId;
          const damage = data.damage || 1;
          const spell = data.spell || 'punch';

          // Track spell usage
          if (player.data && player.data.spellUses[spell] !== undefined) {
            player.data.spellUses[spell]++;
          }

          let targetWs: WebSocket | null = null;
          let targetPlayer: { id: string; data: PlayerData | null } | null = null;

          for (const [ws, p] of this.players) {
            if (p.id === targetId) {
              targetWs = ws;
              targetPlayer = p;
              break;
            }
          }

          if (targetPlayer && targetPlayer.data) {
            targetPlayer.data.health -= damage;
            const newHealth = targetPlayer.data.health;

            this.broadcast(JSON.stringify({
              type: "hit",
              attackerId: player.id,
              targetId: targetId,
              damage: damage,
              newHealth: newHealth
            }));

            if (newHealth <= 0) {
              // Attacker gets a kill
              if (player.data) {
                player.data.kills++;
              }
              // Target gets a death
              targetPlayer.data.deaths++;
              targetPlayer.data.health = MAX_HEALTH;
              targetPlayer.data.x = SPAWN_X;
              targetPlayer.data.y = SPAWN_Y;

              this.broadcast(JSON.stringify({
                type: "kill",
                killerId: player.id,
                victimId: targetId,
                killerKills: player.data?.kills || 0,
                victimDeaths: targetPlayer.data.deaths
              }));

              this.broadcast(JSON.stringify({
                type: "respawn",
                id: targetId,
                x: SPAWN_X,
                y: SPAWN_Y
              }));
            }
          }
        }

        if (data.type === "projectile") {
          // Just broadcast projectiles to other players (spell tracking happens on attack/hit)
          this.broadcast(JSON.stringify(data), server);
        }

        if (data.type === "spell_use") {
          if (player.data && data.spell && player.data.spellUses[data.spell] !== undefined) {
            player.data.spellUses[data.spell]++;
          }
        }

        if (data.type === "get_leaderboard") {
          const leaderboard = [];
          for (const [ws, p] of this.players) {
            if (p.data) {
              leaderboard.push({
                id: p.id,
                hue: p.data.hue,
                kills: p.data.kills,
                deaths: p.data.deaths,
                spellUses: p.data.spellUses
              });
            }
          }
          server.send(JSON.stringify({ type: "leaderboard", players: leaderboard }));
        }

      } catch (e) {
        console.error("Failed to parse message:", e);
      }
    });

    server.addEventListener("close", () => {
      const player = this.players.get(server);
      if (player) {
        this.broadcast(JSON.stringify({ type: "player_left", id: player.id }), server);
      }
      this.players.delete(server);
    });

    server.addEventListener("error", () => {
      const player = this.players.get(server);
      if (player) {
        this.broadcast(JSON.stringify({ type: "player_left", id: player.id }), server);
      }
      this.players.delete(server);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(message: string, exclude?: WebSocket) {
    for (const [ws, _] of this.players) {
      if (ws !== exclude) {
        try { ws.send(message); } catch (e) {}
      }
    }
  }

  cleanupStalePlayers() {
    const now = Date.now();
    const staleTimeout = 5000; // 5 seconds

    for (const [ws, player] of this.players) {
      if (player.data && now - player.data.lastSeen > staleTimeout) {
        // Player is stale, remove them
        this.broadcast(JSON.stringify({ type: "player_left", id: player.id }), ws);
        this.players.delete(ws);
        try { ws.close(); } catch (e) {}
      }
    }
  }
}
