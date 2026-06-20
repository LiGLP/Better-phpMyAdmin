'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./src/routes/auth');
const schemaRoutes = require('./src/routes/schema');
const rowRoutes = require('./src/routes/rows');
const queryRoutes = require('./src/routes/query');
const transferRoutes = require('./src/routes/transfer');

// ---- Configuration (config.json, overridable by config.local.json + env) ----
function loadConfig() {
  const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  const localPath = path.join(__dirname, 'config.local.json');
  if (fs.existsSync(localPath)) {
    const local = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    deepMerge(base, local);
  }
  if (process.env.BPMA_PORT) base.server.port = Number(process.env.BPMA_PORT);
  if (process.env.BPMA_HOST) base.server.host = process.env.BPMA_HOST;
  if (process.env.BPMA_SESSION_SECRET) base.server.sessionSecret = process.env.BPMA_SESSION_SECRET;
  return base;
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      target[key] = target[key] || {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

const config = loadConfig();
const app = express();
app.disable('x-powered-by');

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  name: 'bpma.sid',
  secret: config.server.sessionSecret,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: (config.server.sessionTimeoutMinutes || 120) * 60 * 1000
  }
}));

// ---- API routes ----
app.use('/api/auth', authRoutes(config));
app.use('/api', schemaRoutes());
app.use('/api', rowRoutes(config));
app.use('/api', queryRoutes(config));
app.use('/api', transferRoutes(config));

// Expose a couple of safe limits to the frontend.
app.get('/api/config', (req, res) => {
  res.json({
    rowsPerPage: config.limits.rowsPerPage,
    maxQueryRows: config.limits.maxQueryRows,
    maxImportSizeMB: config.limits.maxImportSizeMB
  });
});

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, 'public')));

// ---- Error handler ----
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.statusCode || 400;
  res.status(status).json({ error: err.message || 'Internal error', code: err.code });
});

// ---- Start ----
function localAddresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

const { port, host } = config.server;
app.listen(port, host, () => {
  const remote = host === '0.0.0.0' || host === '::';
  console.log('\n  Better phpMyAdmin is running');
  console.log('  ---------------------------------------------');
  console.log(`  Local:   http://localhost:${port}`);
  if (remote) {
    for (const ip of localAddresses()) {
      console.log(`  Remote:  http://${ip}:${port}   (other PCs on your network)`);
    }
    console.log('\n  Remote mode is ON (listening on all interfaces).');
    console.log('  On Windows you may need to allow port ' + port + ' through the firewall:');
    console.log(`    netsh advfirewall firewall add rule name="Better phpMyAdmin" dir=in action=allow protocol=TCP localport=${port}`);
  } else {
    console.log('  Remote mode is OFF (localhost only).');
  }
  console.log('  ---------------------------------------------\n');
});
