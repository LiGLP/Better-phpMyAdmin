'use strict';

const express = require('express');
const { asyncHandler, requireAuth, quoteId } = require('../util');

module.exports = function queryRoutes(config) {
  const router = express.Router();
  router.use(requireAuth);

  const maxRows = config.limits.maxQueryRows || 5000;

  // Run an arbitrary SQL statement. Optionally scoped to a database via USE.
  router.post('/query', asyncHandler(async (req, res) => {
    const { sql, db } = req.body || {};
    if (!sql || !sql.trim()) {
      return res.status(400).json({ error: 'Empty query' });
    }

    const conn = await req.pool.getConnection();
    const started = Date.now();
    try {
      if (db) {
        await conn.query(`USE ${quoteId(db)}`);
      }
      const [result, fields] = await conn.query({ sql, rowsAsArray: false });
      const elapsedMs = Date.now() - started;

      // SELECT-style results come back as an array of row objects.
      if (Array.isArray(result)) {
        const columns = fields ? fields.map(f => f.name) : Object.keys(result[0] || {});
        const truncated = result.length > maxRows;
        res.json({
          type: 'rows',
          columns,
          rows: truncated ? result.slice(0, maxRows) : result,
          rowCount: result.length,
          truncated,
          elapsedMs
        });
      } else {
        // INSERT/UPDATE/DELETE/DDL return an OkPacket.
        res.json({
          type: 'ok',
          affectedRows: result.affectedRows,
          insertId: result.insertId,
          info: result.info || '',
          elapsedMs
        });
      }
    } catch (err) {
      res.status(400).json({ error: err.message, code: err.code, sqlState: err.sqlState });
    } finally {
      conn.release();
    }
  }));

  return router;
};
