const { Room } = require('colyseus');
const { Game, COLS, ROWS } = require('../sim');
const { RoomState, FighterState, BombState, PowerupState } = require('../states');

// Bomblox.IO room: up to 8 humans, bots fill to 16. Server runs the sim and is
// the authoritative "host" — autoDispose is off so the room keeps living with
// bots even when no humans are present. Colyseus matchmaking routes a player to
// a room with a free seat and auto-creates a new room when all are full.
class BombloxRoom extends Room {
  onCreate() {
    this.maxClients = 8;            // humans per room (bots fill the rest, up to 16)
    this.autoDispose = false;       // room persists with bots = never-ending .io feel
    this.game = new Game();

    const state = new RoomState();
    state.cols = COLS; state.rows = ROWS;
    state.grid = this.game.gridString();
    for (const f of this.game.fighters) state.fighters.set(String(f.slot), this._mkFighter(f));
    this.setState(state);
    this._lastGrid = state.grid;

    this.onMessage('input', (client, msg) => {
      this.game.setInput(client.sessionId, msg || {});
    });

    // authoritative tick at 20 Hz
    this.setSimulationInterval((dtMs) => this.tick(dtMs / 1000), 1000 / 20);
  }

  onJoin(client, options) {
    const f = this.game.takeSeat(client.sessionId, options && options.name);
    client.userData = { slot: f ? f.slot : -1 };
    // tell the client which fighter is theirs
    client.send('you', { slot: f ? f.slot : -1 });
  }

  onLeave(client) {
    this.game.leaveSeat(client.sessionId);
  }

  tick(dt) {
    // No humans watching? Let the room sleep: keep it alive for matchmaking but
    // don't burn CPU running 16 bots at 20Hz with zero spectators. The sim resumes
    // instantly when a human joins. (This is what was pushing CPU up at 0 CCU.)
    if (this.clients.length === 0) return;

    this.game.step(dt);
    const s = this.state;

    // grid only when it actually changed (crates destroyed / regenerated)
    const g = this.game.gridString();
    if (g !== this._lastGrid) { s.grid = g; this._lastGrid = g; }

    // fighters: update in place (positions, score, alive, drip)
    for (const f of this.game.fighters) {
      const fs = s.fighters.get(String(f.slot));
      fs.c = f.c; fs.r = f.r; fs.dir = f.dir;
      fs.alive = f.alive; fs.score = f.score; fs.swag = f.swag;
      fs.name = f.name; fs.color = f.color; fs.bot = f.isBot;
      fs.bombMax = f.bombMax; fs.range = f.range; fs.speed = f.speed;
    }

    // bombs + powerups change rarely (place/explode/pickup/spawn). Only rebuild the
    // ArraySchema when the set actually changed, so we don't churn the whole array
    // (delete-all + re-add) every tick — that churn scales with count and was a CPU
    // / egress drain as items accumulated.
    const bombSig = this.game.bombs.map(b => b.c + ',' + b.r + ',' + b.range).join(';');
    if (bombSig !== this._bombSig) {
      this._bombSig = bombSig;
      s.bombs.splice(0);
      for (const b of this.game.bombs) { const bs = new BombState(); bs.c = b.c; bs.r = b.r; bs.range = b.range; s.bombs.push(bs); }
    }
    const puSig = this.game.powerups.map(p => p.c + ',' + p.r + ',' + p.type).join(';');
    if (puSig !== this._puSig) {
      this._puSig = puSig;
      s.powerups.splice(0);
      for (const p of this.game.powerups) { const ps = new PowerupState(); ps.c = p.c; ps.r = p.r; ps.type = p.type; s.powerups.push(ps); }
    }
  }

  _mkFighter(f) {
    const fs = new FighterState();
    fs.slot = f.slot; fs.c = f.c; fs.r = f.r; fs.dir = f.dir;
    fs.alive = f.alive; fs.score = f.score; fs.swag = f.swag;
    fs.color = f.color; fs.name = f.name; fs.bot = f.isBot;
    fs.bombMax = f.bombMax; fs.range = f.range; fs.speed = f.speed;
    return fs;
  }
}

module.exports = { BombloxRoom };
