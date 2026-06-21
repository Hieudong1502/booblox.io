const { Client } = require('colyseus.js');
(async () => {
  const client = new Client('ws://localhost:2567');
  const room = await client.joinOrCreate('bomblox', { name: 'Yoyo' });
  let mySlot = -1;
  room.onMessage('you', m => { mySlot = m.slot; console.log('JOINED room', room.roomId, '-> my fighter slot =', m.slot); });

  let firstC=null, firstR=null, lastC=null, lastR=null;
  let ticks=0;
  room.onStateChange((state) => {
    ticks++;
    const me = state.fighters.get(String(mySlot));
    if (me){ if(firstC===null){firstC=me.c;firstR=me.r;} lastC=me.c; lastR=me.r; }
  });

  // wait a moment for first state
  await new Promise(r=>setTimeout(r,600));
  console.log('fighters in state:', room.state.fighters.size, ' grid length:', room.state.grid.length);
  // sample a few fighters
  let sample=[]; room.state.fighters.forEach((f,k)=>{ if(sample.length<4) sample.push(k+':('+f.c.toFixed(1)+','+f.r.toFixed(1)+') '+f.name+(f.bot?'/bot':'/HUMAN')); });
  console.log('sample fighters:', sample.join('  '));

  // drive my fighter for 3s and confirm it moves + bombs land
  const dirs=['right','right','down','down','left','up'];
  for(let i=0;i<60;i++){ room.send('input',{dir:dirs[i%dirs.length], bomb:(i%20===0)}); await new Promise(r=>setTimeout(r,50)); }

  await new Promise(r=>setTimeout(r,500));
  console.log('state updates received:', ticks);
  console.log('my fighter moved from ('+(firstC&&firstC.toFixed(1))+','+(firstR&&firstR.toFixed(1))+') to ('+(lastC&&lastC.toFixed(1))+','+(lastR&&lastR.toFixed(1))+')');
  console.log('bombs visible now:', room.state.bombs.length, ' powerups:', room.state.powerups.length);
  const scores=[]; room.state.fighters.forEach(f=>scores.push(f.score)); scores.sort((a,b)=>b-a);
  console.log('top scores:', scores.slice(0,5).join(','));
  await room.leave();
  console.log('left room cleanly');
  process.exit(0);
})().catch(e=>{ console.error('CLIENT ERROR', e.message); process.exit(1); });
