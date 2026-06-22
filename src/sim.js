// ============================================================================
// Bomblox.IO — headless authoritative simulation (pure logic, no rendering).
// One Game instance == one room. The Colyseus room calls game.step(dt) ~20Hz
// and mirrors game state into the synced schema. Bots fill empty seats so the
// room is always "alive" even with zero humans (server is the host).
// ============================================================================

const COLS = 25, ROWS = 19;
const CAP = 16;                 // total fighters per room (humans + bots)
const FUSE = 2.0;               // seconds before a bomb explodes
const FLAME = 0.5;              // seconds a flame stays lethal
const RESPAWN = 2.8;            // seconds dead before respawn
const CRATE_TARGET = 0.22;      // fraction of free cells that should hold crates
const POWERUP_TTL = 16;         // seconds a dropped power-up stays before despawning
const BOT_RESET_SEC = 150;      // periodically zero bot scores so the leaderboard stays sane
const BASE = { bombMax: 1, range: 1 };
const SPD_BOT = 2.2, SPD_HUMAN = 3.0;

const DIRS = { up:[0,-1], down:[0,1], left:[-1,0], right:[1,0] };
const DIR_LIST = ['up','down','left','right'];
const WALL = 1, CRATE = 2;      // grid cell values (0 = empty)

const key = (c,r) => c + ',' + r;
const rnd = (a) => Math.floor(Math.random()*a);

// crewmate palette (slot 0 reserved feel; bots/humans get a colour by slot)
const COLORS = [0x3a7bd5,0xe53935,0x43c04a,0xf2c40d,0xff8f1f,0x9b59ff,0xff6fb5,
                0x16c79a,0x6b4a2f,0x2b2f3a,0xe9eef5,0x9ad84a,0x33d6ff,0xc0392b,0x7f8c8d,0xffd23a];
const NAMES = ['Red','Green','Yellow','Orange','Purple','Pink','Cyan','Brown',
               'Black','White','Lime','Sky','Crimson','Gray','Gold','Teal'];
// bot nicknames (player-style, NOT colour names) — each room shuffles & hands out
// a distinct one per slot so the leaderboard reads like real opponents
const BOT_NAMES = ['Blaze','Pixel','Mochi','Volt','Ziggy','Rocket','Boomer','Nova',
  'Echo','Frosty','Ghosty','Jinx','Kobo','Loki','Maple','Nitro','Onyx','Pip',
  'Quartz','Rune','Sushi','Tango','Yeti','Zephyr','Bolt','Coco','Dash','Ember',
  'Fizz','Goro','Hazel','Juno','Lumo','Miso','Noodle','Olive','Pebble','Sparky',
  'Turbo','Waffle','Biscuit','Gizmo'];
const shuffle = (a) => { for(let i=a.length-1;i>0;i--){ const j=rnd(i+1); [a[i],a[j]]=[a[j],a[i]]; } return a; };

class Game {
  constructor(){
    this.now = 0;                // ms
    this.grid = [];
    this.fighters = [];          // all 16
    this.bombs = [];
    this.flames = [];
    this.powerups = [];
    this.crateRegenT = 1.2;
    this._botResetT = BOT_RESET_SEC;
    this._botNames = shuffle(BOT_NAMES.slice()).slice(0, CAP);  // distinct nickname per slot
    this._buildArena();
    // fill with bots; humans later replace bots via takeSeat()
    for(let s=0;s<CAP;s++){ const f=this._makeFighter(s, true);
      this._spawning=f; this._placeAt(f, this._freeSpawn()); this._spawning=null;
      this.fighters.push(f);
    }
  }

  // ---- arena: classic pillar grid with border walls + random crates ----
  _buildArena(){
    this.grid = [];
    for(let r=0;r<ROWS;r++){ const row=[];
      for(let c=0;c<COLS;c++){
        if(c===0||r===0||c===COLS-1||r===ROWS-1) row.push(WALL);
        else if(c%2===0 && r%2===0) row.push(WALL);
        else row.push(Math.random()<0.55 ? CRATE : 0);
      }
      this.grid.push(row);
    }
  }
  inBounds(c,r){ return c>=0&&r>=0&&c<COLS&&r<ROWS; }
  isSolidCell(c,r){ return !this.inBounds(c,r) || this.grid[r][c]===WALL || this.grid[r][c]===CRATE; }
  // blocked for a moving fighter (bombs block unless it's the owner still standing on it)
  blocked(c,r,mover){
    if(this.isSolidCell(c,r)) return true;
    for(const b of this.bombs){ if(b.c===c&&b.r===r && (b.solid || b.owner!==mover)) return true; }
    return false;
  }

  _makeFighter(slot, isBot){
    return { slot, isBot, sessionId:null,
      c:0, r:0, tc:null, tr:null, dir:'down',
      alive:true, bombMax:BASE.bombMax, range:BASE.range,
      speed:isBot?SPD_BOT:SPD_HUMAN, bombsActive:0, bombCd:0,
      score:0, kills:0, swag:0, respawnAt:0,
      color:COLORS[slot%COLORS.length], name:this._botNames[slot%this._botNames.length],
      input:{dir:null,bomb:false} };
  }

  // a free empty cell, prefer corners, clears a tiny pocket of crates around it
  _freeSpawn(){
    const corners=[[1,1],[COLS-2,1],[1,ROWS-2],[COLS-2,ROWS-2]];
    const tries=[...corners];
    for(let i=0;i<40;i++) tries.push([1+rnd(COLS-2),1+rnd(ROWS-2)]);
    for(const [c,r] of tries){
      if(this.grid[r][c]===WALL) continue;
      // not too close to a living fighter
      if(this.fighters.some(f=>f.alive&&f!==this._spawning&&Math.abs(Math.round(f.c)-c)+Math.abs(Math.round(f.r)-r)<3)) continue;
      // clear a small pocket so you don't spawn boxed in
      for(const [dc,dr] of [[0,0],[1,0],[-1,0],[0,1],[0,-1]]){
        const cc=c+dc, rr=r+dr;
        if(this.inBounds(cc,rr) && this.grid[rr][cc]===CRATE) this.grid[rr][cc]=0;
      }
      return {c,r};
    }
    return {c:1,r:1};
  }
  _placeAt(f,cell){ f.c=cell.c; f.r=cell.r; f.tc=null; f.tr=null; f.bombsActive=0; }

  // ---- keep the leaderboard reasonable: zero every bot's score/kills ----
  _resetBotScores(){
    for(const f of this.fighters){ if(f.isBot){ f.score=0; f.kills=0; this._resetSwag(f); } }
  }

  // ---- seat management (Colyseus room calls these) ----
  takeSeat(sessionId, name){
    const firstHuman = this.humanCount()===0;
    const f = this.fighters.find(x=>x.isBot);
    if(!f) return null;
    f.isBot=false; f.sessionId=sessionId; f.speed=SPD_HUMAN;
    if(name) f.name=name;
    this._spawning=f; this._placeAt(f, this._freeSpawn()); this._spawning=null;
    f.alive=true; f.bombMax=BASE.bombMax; f.range=BASE.range; f.score=0; f.kills=0; this._resetSwag(f);
    f.input={dir:null,bomb:false};
    if(firstHuman){ this._resetBotScores(); this._botResetT=BOT_RESET_SEC; }  // fresh board for the newcomer
    return f;
  }
  leaveSeat(sessionId){
    const f=this.fighters.find(x=>x.sessionId===sessionId);
    if(f){ f.isBot=true; f.sessionId=null; f.speed=SPD_BOT; f.input={dir:null,bomb:false};
      f.name=this._botNames[f.slot%this._botNames.length]; }   // drop "Player###", become a bot again
  }
  setInput(sessionId, input){
    const f=this.fighters.find(x=>x.sessionId===sessionId);
    if(f && !f.isBot){ f.input.dir=input.dir||null; if(input.bomb) f.input.bomb=true; }
  }
  humanCount(){ return this.fighters.filter(f=>!f.isBot).length; }

  // ===================== main tick =====================
  step(dtSec){
    const dt=Math.min(0.05, dtSec); this.now += dt*1000;
    const danger=this._dangerCells();

    // fighters: humans by input, bots by AI
    for(const f of this.fighters){
      if(!f.alive){ if(this.now>=f.respawnAt) this._respawn(f); continue; }
      if(f.bombCd>0) f.bombCd-=dt;
      if(f.isBot){
        if(f.tc==null){                 // centred on a cell -> make a decision
          f.c=Math.round(f.c); f.r=Math.round(f.r);
          this._botDecide(f, danger);
        }
        this._advance(f, dt);
      } else {
        // human: bomb anytime; move continuously along held input (carry leftover
        // distance into the next cell so there's no per-cell speed loss / stutter)
        if(f.input.bomb){ this._placeBomb(f); f.input.bomb=false; }
        this._advanceHuman(f, dt);
      }
    }
    this._stepBombs(dt);
    this._stepFlames(dt);
    this._stepPickups(dt);
    this.crateRegenT-=dt; if(this.crateRegenT<=0){ this.crateRegenT=1.2; this._regenCrates(); }
    this._botResetT-=dt; if(this._botResetT<=0){ this._botResetT=BOT_RESET_SEC; this._resetBotScores(); }
  }

  _advance(f, dt){
    if(f.tc==null) return;
    const tx=f.tc, ty=f.tr;
    const step=f.speed*dt;
    const dc=Math.sign(tx-f.c), dr=Math.sign(ty-f.r);
    f.c+=dc*step; f.r+=dr*step;
    if(Math.abs(f.c-tx)<=step && Math.abs(f.r-ty)<=step){ f.c=tx; f.r=ty; f.tc=null; f.tr=null; }
  }
  // continuous movement for humans: keep stepping along the held input within the
  // tick's distance budget, chaining cell→cell so no fractional distance is lost.
  _advanceHuman(f, dt){
    let budget=f.speed*dt, guard=0;
    while(budget>1e-6 && guard++<8){
      if(f.tc==null){
        f.c=Math.round(f.c); f.r=Math.round(f.r);
        const dir=f.input.dir;
        if(!dir || !this._tryStep(f, dir)) break;   // no input or blocked → stop centred
      }
      const tx=f.tc, ty=f.tr;
      const dist=Math.abs(tx-f.c)+Math.abs(ty-f.r);
      if(dist<=budget){ budget-=dist; f.c=tx; f.r=ty; f.tc=null; f.tr=null; }
      else { const dc=Math.sign(tx-f.c), dr=Math.sign(ty-f.r); f.c+=dc*budget; f.r+=dr*budget; budget=0; }
    }
  }
  _tryStep(f, dir){
    const [dc,dr]=DIRS[dir]; const nc=Math.round(f.c)+dc, nr=Math.round(f.r)+dr;
    if(this.blocked(nc,nr,f)) return false;
    f.tc=nc; f.tr=nr; f.dir=dir; return true;
  }

  // ---- human decision: follow input, drop bomb on request ----
  _humanDecide(f, danger){
    if(f.input.bomb){ this._placeBomb(f); f.input.bomb=false; }
    if(f.input.dir){ this._tryStep(f, f.input.dir); }
  }

  // ---- bot AI: flee danger, else seek crates/powerups/enemies, bomb wisely ----
  _botDecide(f, danger){
    const here=key(Math.round(f.c),Math.round(f.r));
    if(danger.has(here)){ const d=this._bfsStep(f, (c,r)=>!danger.has(key(c,r)), null); if(d){ this._tryStep(f,d); return; } }
    // consider bombing: next to a crate, or lined up with an enemy, with a safe escape
    if(f.bombCd<=0 && f.bombsActive<f.bombMax && this._goodBombSpot(f) && this._hasEscape(f)){
      this._placeBomb(f); f.bombCd=0.6 + Math.random()*0.5;
      const after=this._dangerCells();
      const d=this._bfsStep(f, (c,r)=>!after.has(key(c,r)), null);
      if(d){ this._tryStep(f,d); return; }
    }
    // seek: nearest powerup -> nearest crate-adjacent -> nearest enemy -> wander
    let d = this._bfsStep(f, (c,r)=> this.powerups.some(p=>p.c===c&&p.r===r), danger)
         || this._bfsStep(f, (c,r)=> this._adjacentCrate(c,r), danger)
         || this._bfsStep(f, (c,r)=> this.fighters.some(o=>o!==f&&o.alive&&Math.round(o.c)===c&&Math.round(o.r)===r), danger);
    if(!d){ const opts=DIR_LIST.filter(x=>{const[a,b]=DIRS[x];return !this.blocked(Math.round(f.c)+a,Math.round(f.r)+b,f)&&!danger.has(key(Math.round(f.c)+a,Math.round(f.r)+b));}); d=opts[rnd(opts.length)]; }
    if(d) this._tryStep(f,d);
  }
  _adjacentCrate(c,r){ for(const k in DIRS){ const[a,b]=DIRS[k]; if(this.inBounds(c+a,r+b)&&this.grid[r+b][c+a]===CRATE) return true; } return false; }
  _goodBombSpot(f){
    const c=Math.round(f.c), r=Math.round(f.r);
    if(this._adjacentCrate(c,r)) return true;
    // enemy within blast line?
    for(const k in DIRS){ const[a,b]=DIRS[k];
      for(let i=1;i<=f.range;i++){ const cc=c+a*i,rr=r+b*i;
        if(!this.inBounds(cc,rr)||this.grid[rr][cc]===WALL) break;
        if(this.grid[rr][cc]===CRATE) return true;
        if(this.fighters.some(o=>o!==f&&o.alive&&Math.round(o.c)===cc&&Math.round(o.r)===rr)) return true;
      } }
    return false;
  }
  // is there at least one safe neighbour to flee to after dropping a bomb here?
  _hasEscape(f){
    const after=this._afterBombDanger(f);
    return this._bfsStep(f, (c,r)=>!after.has(key(c,r)), null) != null;
  }
  _afterBombDanger(f){
    const d=this._dangerCells();
    for(const cell of this._blastCells(Math.round(f.c),Math.round(f.r),f.range)) d.add(key(cell.c,cell.r));
    return d;
  }

  // BFS over free cells; return first-step direction toward nearest cell matching pred
  _bfsStep(f, pred, danger){
    const sc=Math.round(f.c), sr=Math.round(f.r);
    const seen=new Set([key(sc,sr)]); const q=[{c:sc,r:sr,first:null}];
    let head=0;
    while(head<q.length && head<400){
      const n=q[head++];
      if(n.first!==null && pred(n.c,n.r)) return n.first;
      for(const k of DIR_LIST){ const[a,b]=DIRS[k]; const cc=n.c+a, rr=n.r+b; const kk=key(cc,rr);
        if(seen.has(kk)) continue; seen.add(kk);
        if(this.isSolidCell(cc,rr)) continue;               // crates/walls block pathing
        if(danger && danger.has(kk) && n.first===null) continue; // don't step into danger first
        q.push({c:cc,r:rr,first:n.first||k});
      }
    }
    return null;
  }

  // ---- bombs ----
  _placeBomb(f){
    const c=Math.round(f.c), r=Math.round(f.r);
    if(f.bombsActive>=f.bombMax) return;
    if(this.bombs.some(b=>b.c===c&&b.r===r)) return;
    this.bombs.push({ c, r, t:0, range:f.range, owner:f, solid:false });
    f.bombsActive++;
  }
  _stepBombs(dt){
    // advance fuse + solidity (no array mutation here)
    for(const b of this.bombs){
      b.t+=dt;
      if(!b.solid && (Math.round(b.owner.c)!==b.c || Math.round(b.owner.r)!==b.r)) b.solid=true;
    }
    // detonate expired bombs one at a time. _explode() may chain-remove OTHER bombs
    // from this.bombs, so we re-scan each pass instead of holding a stale index
    // (holding an index here crashes when a chain shrinks the array mid-loop).
    for(let guard=0; guard<this.bombs.length+64; guard++){
      const idx=this.bombs.findIndex(b=>b.t>=FUSE);
      if(idx<0) break;
      const b=this.bombs[idx];
      this.bombs.splice(idx,1);
      this._explode(b);
    }
  }
  _blastCells(c,r,range){
    const cells=[{c,r}];
    for(const k in DIRS){ const[a,b]=DIRS[k];
      for(let i=1;i<=range;i++){ const cc=c+a*i, rr=r+b*i;
        if(!this.inBounds(cc,rr)||this.grid[rr][cc]===WALL) break;
        cells.push({c:cc,r:rr});
        if(this.grid[rr][cc]===CRATE) break;
      } }
    return cells;
  }
  _dangerCells(){
    const d=new Set();
    for(const b of this.bombs) for(const cell of this._blastCells(b.c,b.r,b.range)) d.add(key(cell.c,cell.r));
    return d;
  }
  _explode(bomb){
    if(bomb.owner) bomb.owner.bombsActive=Math.max(0,bomb.owner.bombsActive-1);
    const cells=this._blastCells(bomb.c,bomb.r,bomb.range);
    for(const {c,r} of cells){
      if(this.grid[r][c]===CRATE){ this._destroyCrate(c,r,bomb.owner); }
      this.flames.push({c,r,t:0,owner:bomb.owner});
      // chain other bombs caught in the blast
      const hit=this.bombs.find(b=>b.c===c&&b.r===r);
      if(hit){ this.bombs.splice(this.bombs.indexOf(hit),1); this._explode(hit); }
    }
  }
  _destroyCrate(c,r,owner){
    this.grid[r][c]=0;
    if(owner) owner.score+=5;
    if(Math.random()<0.32){
      const type=['bomb','range','speed'][rnd(3)];
      this.powerups.push({c,r,type,t:0});
    }
  }
  _stepFlames(dt){
    for(let i=this.flames.length-1;i>=0;i--){
      const fl=this.flames[i]; fl.t+=dt;
      for(const ft of this.fighters){ if(ft.alive && Math.round(ft.c)===fl.c && Math.round(ft.r)===fl.r) this._kill(ft, fl.owner); }
      if(fl.t>=FLAME) this.flames.splice(i,1);
    }
  }

  // ---- powerups ----
  _stepPickups(dt){
    for(let i=this.powerups.length-1;i>=0;i--){
      const p=this.powerups[i];
      const taker=this.fighters.find(f=>f.alive&&Math.round(f.c)===p.c&&Math.round(f.r)===p.r);
      if(taker){ this._applyPowerup(taker,p.type); taker.score+=10; this._bumpSwag(taker); this.powerups.splice(i,1); continue; }
      p.t+=dt; if(p.t>=POWERUP_TTL) this.powerups.splice(i,1);   // despawn so items can't pile up
    }
  }
  _applyPowerup(f,type){
    if(type==='bomb')  f.bombMax=Math.min(f.isBot?2:9, f.bombMax+1);
    else if(type==='range') f.range=Math.min(f.isBot?3:9, f.range+1);
    else if(type==='speed') f.speed=Math.min(f.isBot?3.2:5.0, f.speed+(f.isBot?0.4:0.6));
  }

  // ---- kills / respawn ----
  _kill(f, owner){
    if(!f.alive) return;
    f.alive=false; f.respawnAt=this.now+RESPAWN*1000; f.tc=null; f.tr=null;
    if(owner && owner!==f){ owner.score+=100; owner.kills++; this._bumpSwag(owner); }
  }
  _respawn(f){
    this._spawning=f; this._placeAt(f, this._freeSpawn()); this._spawning=null;
    f.alive=true; f.bombMax=BASE.bombMax; f.range=BASE.range;
    f.speed=f.isBot?SPD_BOT:SPD_HUMAN; f.bombsActive=0; f.bombCd=0;
    this._resetSwag(f);
  }

  // ---- swag (cosmetic tier, synced so clients show the drip) ----
  _bumpSwag(f){ f.swag=Math.min(6,(f.swag||0)+1); }
  _resetSwag(f){ f.swag=0; }

  // ---- crate regen keeps the arena stocked ----
  _regenCrates(){
    let free=0, crates=0;
    for(let r=1;r<ROWS-1;r++) for(let c=1;c<COLS-1;c++){
      if(this.grid[r][c]===WALL) continue; free++; if(this.grid[r][c]===CRATE) crates++;
    }
    const want=Math.floor(free*CRATE_TARGET);
    let add=want-crates; let guard=0;
    while(add>0 && guard++<60){
      const c=1+rnd(COLS-2), r=1+rnd(ROWS-2);
      if(this.grid[r][c]!==0) continue;
      if(this.fighters.some(f=>f.alive&&Math.round(f.c)===c&&Math.round(f.r)===r)) continue;
      if(this.bombs.some(b=>b.c===c&&b.r===r)||this.powerups.some(p=>p.c===c&&p.r===r)) continue;
      this.grid[r][c]=CRATE; add--;
    }
  }

  // ---- snapshot for the Colyseus schema mirror ----
  gridString(){ return this.grid.map(row=>row.join('')).join('|'); }
}

module.exports = { Game, COLS, ROWS, CAP };
