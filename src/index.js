const { listen } = require('@colyseus/tools');
const app = require('./app.config');

// Colyseus Cloud sets PORT automatically; locally defaults to 2567.
listen(app);
