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

interface SpellData {
  id: string;
  owner_id: string;
  name: string;
  points_damage: number;
  points_aoe: number;
  points_speed: number;
  points_cooldown: number;
  points_range: number;
  points_projectile_count: number;
  points_homing: number;
  sprite_size: number;
  sprite_pixels: string;
  sprite_palette: string;
}

interface TeamData {
  id: string;
  name: string;
  color: string;
  creator_id: string;
}

interface AccountData {
  id: string;
  username: string;
  team_id: string | null;
  equipped_spell_1: string | null;
  equipped_spell_2: string | null;
  equipped_spell_3: string | null;
}

interface PlayerData {
  x: number;
  y: number;
  hue: number;
  facingRight: boolean;
  health: number;
  kills: number;
  deaths: number;
  spellUses: { [key: string]: number };
  lastSeen: number;
  username: string | null;
  accountId: string | null;
  teamId: string | null;
  teamColor: string | null;
  teamName: string | null;
  equippedSpells: (SpellData | null)[];
}

export class GameRoom {
  state: DurableObjectState;
  players: Map<WebSocket, { id: string; data: PlayerData | null }>;
  nextId: number;
  dbInitialized: boolean;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.players = new Map();
    this.nextId = 1;
    this.dbInitialized = false;
  }

  async initDB() {
    if (this.dbInitialized) return;

    const sql = this.state.storage.sql;

    sql.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        team_id TEXT,
        equipped_spell_1 TEXT,
        equipped_spell_2 TEXT,
        equipped_spell_3 TEXT
      )
    `);

    sql.exec(`
      CREATE TABLE IF NOT EXISTS spells (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        points_damage INTEGER DEFAULT 1,
        points_aoe INTEGER DEFAULT 0,
        points_speed INTEGER DEFAULT 1,
        points_cooldown INTEGER DEFAULT 1,
        points_range INTEGER DEFAULT 1,
        points_projectile_count INTEGER DEFAULT 0,
        points_homing INTEGER DEFAULT 0,
        sprite_size INTEGER DEFAULT 8,
        sprite_pixels TEXT DEFAULT '',
        sprite_palette TEXT DEFAULT ''
      )
    `);

    sql.exec(`
      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        color TEXT NOT NULL,
        creator_id TEXT NOT NULL
      )
    `);

    this.dbInitialized = true;
  }

  generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + "mage_battle_salt_2024");
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async fetch(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    await this.initDB();

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const playerId = `player_${this.nextId++}`;
    this.players.set(server, { id: playerId, data: null });

    server.accept();

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

    server.addEventListener("message", async (event) => {
      try {
        const data = JSON.parse(event.data as string);
        const player = this.players.get(server);
        if (!player) return;

        await this.handleMessage(server, player, data);
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

  async handleMessage(server: WebSocket, player: { id: string; data: PlayerData | null }, data: any) {
    const sql = this.state.storage.sql;

    switch (data.type) {
      case "register": {
        const { username, password } = data;
        if (!username || !password || username.length < 3 || password.length < 4) {
          server.send(JSON.stringify({ type: "auth_error", message: "Invalid username or password" }));
          return;
        }

        const existing = sql.exec("SELECT id FROM accounts WHERE username = ?", username).toArray();
        if (existing.length > 0) {
          server.send(JSON.stringify({ type: "auth_error", message: "Username already exists" }));
          return;
        }

        const accountId = this.generateId();
        const passwordHash = await this.hashPassword(password);
        sql.exec(
          "INSERT INTO accounts (id, username, password_hash) VALUES (?, ?, ?)",
          accountId, username, passwordHash
        );

        const account = this.getAccountWithTeam(accountId);
        const spells = this.getAccountSpells(accountId);
        const equippedSpells = this.getEquippedSpells(account);

        server.send(JSON.stringify({
          type: "auth_success",
          accountId,
          username,
          teamId: account?.team_id || null,
          teamName: account?.teamName || null,
          teamColor: account?.teamColor || null,
          spells,
          equippedSpells
        }));
        break;
      }

      case "login": {
        const { username, password } = data;
        const passwordHash = await this.hashPassword(password);
        const results = sql.exec(
          "SELECT id, username FROM accounts WHERE username = ? AND password_hash = ?",
          username, passwordHash
        ).toArray();

        if (results.length === 0) {
          server.send(JSON.stringify({ type: "auth_error", message: "Invalid username or password" }));
          return;
        }

        const account = results[0] as { id: string; username: string };
        const fullAccount = this.getAccountWithTeam(account.id);
        const spells = this.getAccountSpells(account.id);
        const equippedSpells = this.getEquippedSpells(fullAccount);

        server.send(JSON.stringify({
          type: "auth_success",
          accountId: account.id,
          username: account.username,
          teamId: fullAccount?.team_id || null,
          teamName: fullAccount?.teamName || null,
          teamColor: fullAccount?.teamColor || null,
          spells,
          equippedSpells
        }));
        break;
      }

      case "guest_play": {
        server.send(JSON.stringify({
          type: "auth_success",
          accountId: null,
          username: null,
          teamId: null,
          teamName: null,
          teamColor: null,
          spells: [],
          equippedSpells: [null, null, null]
        }));
        break;
      }

      case "update": {
        const prev = player.data;
        player.data = {
          x: data.x,
          y: data.y,
          hue: data.hue,
          facingRight: data.facingRight,
          health: prev?.health ?? MAX_HEALTH,
          kills: prev?.kills ?? 0,
          deaths: prev?.deaths ?? 0,
          spellUses: prev?.spellUses ?? {},
          lastSeen: Date.now(),
          username: data.username ?? prev?.username ?? null,
          accountId: data.accountId ?? prev?.accountId ?? null,
          teamId: data.teamId ?? prev?.teamId ?? null,
          teamColor: data.teamColor ?? prev?.teamColor ?? null,
          teamName: data.teamName ?? prev?.teamName ?? null,
          equippedSpells: data.equippedSpells ?? prev?.equippedSpells ?? [null, null, null]
        };

        this.cleanupStalePlayers();

        this.broadcast(JSON.stringify({
          type: "player_update",
          id: player.id,
          ...player.data
        }), server);
        break;
      }

      case "attack": {
        const targetId = data.targetId;
        const damage = data.damage || 1;
        const spell = data.spell || 'punch';

        if (player.data) {
          if (!player.data.spellUses[spell]) player.data.spellUses[spell] = 0;
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
          // Cap health at max (for healing spells)
          if (targetPlayer.data.health > MAX_HEALTH) {
            targetPlayer.data.health = MAX_HEALTH;
          }
          const newHealth = targetPlayer.data.health;

          this.broadcast(JSON.stringify({
            type: "hit",
            attackerId: player.id,
            targetId: targetId,
            damage: damage,
            newHealth: newHealth
          }));

          if (newHealth <= 0) {
            if (player.data) {
              player.data.kills++;
            }
            targetPlayer.data.deaths++;
            targetPlayer.data.health = MAX_HEALTH;
            targetPlayer.data.x = SPAWN_X;
            targetPlayer.data.y = SPAWN_Y;

            this.broadcast(JSON.stringify({
              type: "kill",
              killerId: player.id,
              killerUsername: player.data?.username,
              victimId: targetId,
              victimUsername: targetPlayer.data.username,
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
        break;
      }

      case "projectile": {
        this.broadcast(JSON.stringify(data), server);
        break;
      }

      case "spell_use": {
        if (player.data && data.spell) {
          if (!player.data.spellUses[data.spell]) player.data.spellUses[data.spell] = 0;
          player.data.spellUses[data.spell]++;
        }
        break;
      }

      case "get_leaderboard": {
        const leaderboard = [];
        for (const [ws, p] of this.players) {
          if (p.data) {
            leaderboard.push({
              id: p.id,
              hue: p.data.hue,
              kills: p.data.kills,
              deaths: p.data.deaths,
              spellUses: p.data.spellUses,
              username: p.data.username,
              teamName: p.data.teamName,
              teamColor: p.data.teamColor
            });
          }
        }
        server.send(JSON.stringify({ type: "leaderboard", players: leaderboard }));
        break;
      }

      case "create_spell": {
        const { accountId, name, points, sprite } = data;
        if (!accountId) {
          server.send(JSON.stringify({ type: "spell_error", message: "Must be logged in" }));
          return;
        }

        const existingSpells = sql.exec("SELECT COUNT(*) as count FROM spells WHERE owner_id = ?", accountId).toArray();
        if ((existingSpells[0] as any).count >= 10) {
          server.send(JSON.stringify({ type: "spell_error", message: "Maximum 10 spells allowed" }));
          return;
        }

        const spellId = this.generateId();
        sql.exec(
          `INSERT INTO spells (id, owner_id, name, points_damage, points_aoe, points_speed,
            points_cooldown, points_range, points_projectile_count, points_homing,
            sprite_size, sprite_pixels, sprite_palette)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          spellId, accountId, name,
          points.damage, points.aoe, points.speed, points.cooldown, points.range,
          points.projectileCount, points.homing,
          sprite.size, sprite.pixels, sprite.palette
        );

        const spells = this.getAccountSpells(accountId);
        server.send(JSON.stringify({ type: "spells_updated", spells }));
        break;
      }

      case "update_spell": {
        const { accountId, spellId, name, points, sprite } = data;
        if (!accountId) {
          server.send(JSON.stringify({ type: "spell_error", message: "Must be logged in" }));
          return;
        }

        sql.exec(
          `UPDATE spells SET name = ?, points_damage = ?, points_aoe = ?, points_speed = ?,
            points_cooldown = ?, points_range = ?, points_projectile_count = ?, points_homing = ?,
            sprite_size = ?, sprite_pixels = ?, sprite_palette = ?
           WHERE id = ? AND owner_id = ?`,
          name, points.damage, points.aoe, points.speed, points.cooldown, points.range,
          points.projectileCount, points.homing, sprite.size, sprite.pixels, sprite.palette,
          spellId, accountId
        );

        const spells = this.getAccountSpells(accountId);
        const account = this.getAccountWithTeam(accountId);
        const equippedSpells = this.getEquippedSpells(account);
        server.send(JSON.stringify({ type: "spells_updated", spells, equippedSpells }));
        break;
      }

      case "delete_spell": {
        const { accountId, spellId } = data;
        if (!accountId) {
          server.send(JSON.stringify({ type: "spell_error", message: "Must be logged in" }));
          return;
        }

        sql.exec("DELETE FROM spells WHERE id = ? AND owner_id = ?", spellId, accountId);
        sql.exec("UPDATE accounts SET equipped_spell_1 = NULL WHERE equipped_spell_1 = ?", spellId);
        sql.exec("UPDATE accounts SET equipped_spell_2 = NULL WHERE equipped_spell_2 = ?", spellId);
        sql.exec("UPDATE accounts SET equipped_spell_3 = NULL WHERE equipped_spell_3 = ?", spellId);

        const spells = this.getAccountSpells(accountId);
        const account = this.getAccountWithTeam(accountId);
        const equippedSpells = this.getEquippedSpells(account);
        server.send(JSON.stringify({ type: "spells_updated", spells, equippedSpells }));
        break;
      }

      case "equip_spell": {
        const { accountId, spellId, slot } = data;
        if (!accountId || slot < 0 || slot > 2) {
          server.send(JSON.stringify({ type: "spell_error", message: "Invalid request" }));
          return;
        }

        const column = `equipped_spell_${slot + 1}`;
        sql.exec(`UPDATE accounts SET ${column} = ? WHERE id = ?`, spellId, accountId);

        const account = this.getAccountWithTeam(accountId);
        const equippedSpells = this.getEquippedSpells(account);
        server.send(JSON.stringify({ type: "equipped_updated", equippedSpells }));
        break;
      }

      case "unequip_spell": {
        const { accountId, slot } = data;
        if (!accountId || slot < 0 || slot > 2) {
          server.send(JSON.stringify({ type: "spell_error", message: "Invalid request" }));
          return;
        }

        const column = `equipped_spell_${slot + 1}`;
        sql.exec(`UPDATE accounts SET ${column} = NULL WHERE id = ?`, accountId);

        const account = this.getAccountWithTeam(accountId);
        const equippedSpells = this.getEquippedSpells(account);
        server.send(JSON.stringify({ type: "equipped_updated", equippedSpells }));
        break;
      }

      case "create_team": {
        const { accountId, name, color } = data;
        if (!accountId) {
          server.send(JSON.stringify({ type: "team_error", message: "Must be logged in" }));
          return;
        }

        if (!name || name.length < 2) {
          server.send(JSON.stringify({ type: "team_error", message: "Team name too short" }));
          return;
        }

        const existing = sql.exec("SELECT id FROM teams WHERE name = ?", name).toArray();
        if (existing.length > 0) {
          server.send(JSON.stringify({ type: "team_error", message: "Team name already exists" }));
          return;
        }

        const teamId = this.generateId();
        sql.exec("INSERT INTO teams (id, name, color, creator_id) VALUES (?, ?, ?, ?)",
          teamId, name, color, accountId);
        sql.exec("UPDATE accounts SET team_id = ? WHERE id = ?", teamId, accountId);

        server.send(JSON.stringify({
          type: "team_joined",
          teamId,
          teamName: name,
          teamColor: color
        }));
        break;
      }

      case "join_team": {
        const { accountId, teamName } = data;
        if (!accountId) {
          server.send(JSON.stringify({ type: "team_error", message: "Must be logged in" }));
          return;
        }

        const teams = sql.exec("SELECT id, name, color FROM teams WHERE name = ?", teamName).toArray();
        if (teams.length === 0) {
          server.send(JSON.stringify({ type: "team_error", message: "Team not found" }));
          return;
        }

        const team = teams[0] as TeamData;
        sql.exec("UPDATE accounts SET team_id = ? WHERE id = ?", team.id, accountId);

        server.send(JSON.stringify({
          type: "team_joined",
          teamId: team.id,
          teamName: team.name,
          teamColor: team.color
        }));
        break;
      }

      case "leave_team": {
        const { accountId } = data;
        if (!accountId) {
          server.send(JSON.stringify({ type: "team_error", message: "Must be logged in" }));
          return;
        }

        sql.exec("UPDATE accounts SET team_id = NULL WHERE id = ?", accountId);
        server.send(JSON.stringify({ type: "team_left" }));
        break;
      }

      case "get_account_data": {
        const { accountId } = data;
        if (!accountId) {
          server.send(JSON.stringify({ type: "account_data", data: null }));
          return;
        }

        const account = this.getAccountWithTeam(accountId);
        const spells = this.getAccountSpells(accountId);
        const equippedSpells = this.getEquippedSpells(account);

        server.send(JSON.stringify({
          type: "account_data",
          data: account ? {
            ...account,
            spells,
            equippedSpells
          } : null
        }));
        break;
      }
    }
  }

  getAccountWithTeam(accountId: string): (AccountData & { teamName?: string; teamColor?: string }) | null {
    const sql = this.state.storage.sql;
    const results = sql.exec(
      `SELECT a.*, t.name as teamName, t.color as teamColor
       FROM accounts a LEFT JOIN teams t ON a.team_id = t.id
       WHERE a.id = ?`, accountId
    ).toArray();

    if (results.length === 0) return null;
    return results[0] as any;
  }

  getAccountSpells(accountId: string): SpellData[] {
    const sql = this.state.storage.sql;
    return sql.exec("SELECT * FROM spells WHERE owner_id = ?", accountId).toArray() as SpellData[];
  }

  getEquippedSpells(account: AccountData | null): (SpellData | null)[] {
    if (!account) return [null, null, null];

    const sql = this.state.storage.sql;
    const slots = [account.equipped_spell_1, account.equipped_spell_2, account.equipped_spell_3];

    return slots.map(spellId => {
      if (!spellId) return null;
      const results = sql.exec("SELECT * FROM spells WHERE id = ?", spellId).toArray();
      return results.length > 0 ? (results[0] as SpellData) : null;
    });
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
    const staleTimeout = 5000;

    for (const [ws, player] of this.players) {
      if (player.data && now - player.data.lastSeen > staleTimeout) {
        this.broadcast(JSON.stringify({ type: "player_left", id: player.id }), ws);
        this.players.delete(ws);
        try { ws.close(); } catch (e) {}
      }
    }
  }
}
