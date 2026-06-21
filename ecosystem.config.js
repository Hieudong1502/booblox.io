// Required by Colyseus Cloud (it runs your app under PM2 + NGINX).
// Single fork process = no Redis needed. Scale later from the Cloud dashboard.
module.exports = {
  apps: [{
    name: "bomblox",
    script: "src/index.js",
    instances: 1,
    exec_mode: "fork",
    wait_ready: true,
    env_production: { NODE_ENV: "production" }
  }]
};
