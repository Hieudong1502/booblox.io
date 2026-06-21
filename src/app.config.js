const config = require('@colyseus/tools').default;
const { BombloxRoom } = require('./rooms/BombloxRoom');

module.exports = config({
  initializeGameServer: (gameServer) => {
    // a player is routed to an existing 'bomblox' room with a free seat,
    // or a new one is created automatically when all are full
    gameServer.define('bomblox', BombloxRoom);
  },
  initializeExpress: (app) => {
    app.get('/health', (_req, res) => res.send('ok'));
  },
  beforeListen: () => {},
});
