const { Schema, MapSchema, ArraySchema, defineTypes } = require('@colyseus/schema');

class FighterState extends Schema {}
defineTypes(FighterState, {
  slot:'uint8', c:'float32', r:'float32', dir:'string',
  alive:'boolean', score:'uint32', swag:'uint8',
  color:'uint32', name:'string', bot:'boolean',
  bombMax:'uint8', range:'uint8', speed:'float32'
});

class BombState extends Schema {}
defineTypes(BombState, { c:'uint8', r:'uint8', range:'uint8' });

class PowerupState extends Schema {}
defineTypes(PowerupState, { c:'uint8', r:'uint8', type:'string' });

class RoomState extends Schema {
  constructor(){
    super();
    this.fighters = new MapSchema();   // keyed by slot
    this.bombs = new ArraySchema();
    this.powerups = new ArraySchema();
    this.grid = '';
    this.cols = 0; this.rows = 0;
  }
}
defineTypes(RoomState, {
  cols:'uint8', rows:'uint8', grid:'string',
  fighters:{ map: FighterState },
  bombs:{ array: BombState },
  powerups:{ array: PowerupState }
});

module.exports = { FighterState, BombState, PowerupState, RoomState };
