import type { Party, PartyKitServer, Connection } from "partykit/server";

interface PlayerData {
  x: number;
  y: number;
  hue: number;
  facingRight: boolean;
}

interface Players {
  [id: string]: PlayerData;
}

export default class GameServer implements PartyKitServer {
  players: Players = {};

  constructor(public room: Party) {}

  onConnect(conn: Connection) {
    // Send current players to newly connected client
    conn.send(JSON.stringify({
      type: "init",
      players: this.players,
      yourId: conn.id
    }));

    // Notify others of new player
    this.room.broadcast(JSON.stringify({
      type: "player_joined",
      id: conn.id
    }), [conn.id]);

    console.log(`Player connected: ${conn.id}`);
  }

  onMessage(message: string, sender: Connection) {
    try {
      const data = JSON.parse(message);

      if (data.type === "update") {
        // Update player position
        this.players[sender.id] = {
          x: data.x,
          y: data.y,
          hue: data.hue,
          facingRight: data.facingRight
        };

        // Broadcast to all other players
        this.room.broadcast(JSON.stringify({
          type: "player_update",
          id: sender.id,
          ...this.players[sender.id]
        }), [sender.id]);
      }
    } catch (e) {
      console.error("Failed to parse message:", e);
    }
  }

  onClose(conn: Connection) {
    // Remove player
    delete this.players[conn.id];

    // Notify others
    this.room.broadcast(JSON.stringify({
      type: "player_left",
      id: conn.id
    }));

    console.log(`Player disconnected: ${conn.id}`);
  }
}
