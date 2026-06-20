'use strict';

const express = require('express');
const { testConnection } = require('../db');
const { asyncHandler } = require('../util');

module.exports = function authRoutes(config) {
  const router = express.Router();

  // Expose connection defaults (never the password) so the login form can prefill.
  router.get('/defaults', (req, res) => {
    res.json({
      host: config.defaults.host,
      port: config.defaults.port,
      user: config.defaults.user
    });
  });

  // Report whether the current session is logged in.
  router.get('/session', (req, res) => {
    if (req.session && req.session.creds) {
      const { host, port, user } = req.session.creds;
      return res.json({ authenticated: true, host, port, user, version: req.session.version });
    }
    res.json({ authenticated: false });
  });

  router.post('/login', asyncHandler(async (req, res) => {
    const { host, port, user, password } = req.body || {};
    const creds = {
      host: (host || config.defaults.host || '127.0.0.1').trim(),
      port: Number(port) || config.defaults.port || 3306,
      user: (user || '').trim(),
      password: password == null ? '' : String(password)
    };
    if (!creds.user) {
      return res.status(400).json({ error: 'Username is required' });
    }
    try {
      const version = await testConnection(creds);
      req.session.creds = creds;
      req.session.version = version;
      res.json({ authenticated: true, host: creds.host, port: creds.port, user: creds.user, version });
    } catch (err) {
      res.status(401).json({ error: 'Connection failed: ' + err.message });
    }
  }));

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  return router;
};
