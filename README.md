# Bomblox.IO — Authoritative Multiplayer Server (Colyseus)

The server is the **host**: it runs the full game simulation (bombs, bots,
scoring, respawns, drip) and is the single source of truth. Browsers are thin
clients that **send input** and **render the synced state**.

## Room model (public 20+ .io)
- **Up to 24 humans per room**; bots fill every empty seat so a room is always
  full (24 fighters on a 31×23 arena).
- Colyseus matchmaking routes a player into a `bomblox` room that has a free
  seat, and **auto-creates a new room when all 24 are full** (public spill).
- `autoDispose = false` → a room keeps running with bots even when no humans are
  in it, so there is **always a populated public room** and it **never ends**.
- When a human leaves, their seat reverts to a bot.
- 24 (>=20) qualifies for CrazyGames' **public Instant Multiplayer** drop-in:
  on the Multiplayer landing page the player is dropped straight into public
  gameplay. Submit lobby size **24** when uploading the build. (Friends can still
  join via room data reported through the CrazyGames SDK — wired at the end.)
- Server cost is tiny: one tick of a full 24-fighter room measures ~0.2 ms, so a
  single small Cloud instance runs many rooms.

## Run locally
```bash
npm install
npm start          # listens on http://localhost:2567  (ws://localhost:2567)
```

## Deploy to Colyseus Cloud
Colyseus Cloud runs your app under NGINX + PM2 and reads `ecosystem.config.js`
(already included, entrypoint `src/index.js`). It gives you a public **wss://**
endpoint with TLS — required because CrazyGames serves over https.

1. Create an account + an application at https://cloud.colyseus.io
2. Put this folder in a Git repo and push it:
   ```bash
   git init && git add . && git commit -m "bomblox server"
   git remote add origin git@github.com:<you>/bomblox-server.git
   git push -u origin main
   ```
   (`node_modules/` is gitignored — Cloud installs deps itself.)
3. From this folder, run the deploy CLI and follow the browser prompt to pick
   your application:
   ```bash
   npm install @colyseus/cloud
   npx @colyseus/cloud deploy
   ```
   This creates a `.colyseus-cloud.json` at the project root with deploy
   credentials — **keep it safe / out of public repos** (add to .gitignore).
4. After it deploys, the Cloud dashboard shows your endpoint, e.g.
   `wss://xxxx.colyseus.cloud`. That's what the browser/Unity client connects to.
5. (Optional) For push-to-deploy later, add the GitHub Actions workflow from
   https://docs.colyseus.io/cloud/continuous-deployment/

Re-deploy anytime with `npx @colyseus/cloud deploy`.

## Client protocol (for the browser game)
Connect with `colyseus.js`:
```js
import { Client } from "colyseus.js";
const client = new Client("wss://<your-cloud-endpoint>");   // ws://localhost:2567 locally
const room = await client.joinOrCreate("bomblox", { name: "Yoyo" });

room.onMessage("you", (m) => { mySlot = m.slot; });   // which fighter is yours

room.onStateChange((state) => {
  // state.cols, state.rows
  // state.grid  -> rows joined by "|", each char: 0 empty, 1 wall, 2 crate
  // state.fighters (MapSchema keyed by slot): {slot,c,r,dir,alive,score,swag,color,name,bot}
  // state.bombs (Array): {c,r,range}
  // state.powerups (Array): {c,r,type}  type in "bomb"|"range"|"speed"
});

// send input ~20 Hz (dir = "up"|"down"|"left"|"right"|null, bomb = true to drop)
room.send("input", { dir, bomb });
```

Render with your existing Three.js code: build the arena from `grid`, draw a
crewmate per fighter at `(c,r)` (interpolate for smoothness), draw bombs/flames/
powerups, and apply the **drip** by reading `fighter.swag` (0–6).

## Files
- `src/sim.js` — headless authoritative game logic (no rendering). Verified.
- `src/states.js` — Colyseus synced schema.
- `src/rooms/BombloxRoom.js` — room: seats, input, 20 Hz tick, state mirror.
- `src/app.config.js` / `src/index.js` — server bootstrap (Cloud-compatible).
- `clienttest.js` — local smoke test (join, drive a fighter, read state).
