'use strict';

const express = require('express');
const { asyncHandler, requireAuth, quoteId } = require('../util');

const SYSTEM_DBS = new Set(['information_schema', 'performance_schema', 'mysql', 'sys']);

module.exports = function schemaRoutes() {
  const router = express.Router();
  router.use(requireAuth);

  // List databases, each with a table count.
  router.get('/databases', asyncHandler(async (req, res) => {
    const [rows] = await req.pool.query(
      `SELECT s.SCHEMA_NAME AS name,
              (SELECT COUNT(*) FROM information_schema.TABLES t
                 WHERE t.TABLE_SCHEMA = s.SCHEMA_NAME) AS tableCount
         FROM information_schema.SCHEMATA s
        ORDER BY s.SCHEMA_NAME`
    );
    res.json(rows.map(r => ({
      name: r.name,
      tableCount: Number(r.tableCount),
      system: SYSTEM_DBS.has(r.name.toLowerCase())
    })));
  }));

  // List tables (and views) in a database with row estimates and size.
  router.get('/databases/:db/tables', asyncHandler(async (req, res) => {
    const { db } = req.params;
    const [rows] = await req.pool.query(
      `SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine,
              TABLE_ROWS AS rows, DATA_LENGTH AS dataLength, INDEX_LENGTH AS indexLength,
              TABLE_COMMENT AS comment
         FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME`,
      [db]
    );
    res.json(rows.map(r => ({
      name: r.name,
      type: r.type === 'VIEW' ? 'view' : 'table',
      engine: r.engine,
      rows: r.rows == null ? null : Number(r.rows),
      size: (Number(r.dataLength) || 0) + (Number(r.indexLength) || 0),
      comment: r.comment
    })));
  }));

  // Column / structure information for one table.
  router.get('/databases/:db/tables/:table/structure', asyncHandler(async (req, res) => {
    const { db, table } = req.params;
    const [cols] = await req.pool.query(
      `SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE AS nullable,
              COLUMN_KEY AS keyType, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra,
              COLUMN_COMMENT AS comment, ORDINAL_POSITION AS position
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION`,
      [db, table]
    );
    const [indexes] = await req.pool.query(
      `SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique, COLUMN_NAME AS column,
              SEQ_IN_INDEX AS seq, INDEX_TYPE AS type
         FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
        ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
      [db, table]
    );
    res.json({
      columns: cols.map(c => ({
        name: c.name,
        type: c.type,
        nullable: c.nullable === 'YES',
        key: c.keyType,
        default: c.defaultValue,
        extra: c.extra,
        comment: c.comment
      })),
      indexes
    });
  }));

  // Raw CREATE TABLE statement.
  router.get('/databases/:db/tables/:table/create', asyncHandler(async (req, res) => {
    const { db, table } = req.params;
    const [rows] = await req.pool.query(
      `SHOW CREATE TABLE ${quoteId(db)}.${quoteId(table)}`
    );
    const row = rows[0] || {};
    res.json({ sql: row['Create Table'] || row['Create View'] || '' });
  }));

  // Create a new database.
  router.post('/databases', asyncHandler(async (req, res) => {
    const { name, charset } = req.body || {};
    const cs = charset && /^[a-zA-Z0-9_]+$/.test(charset) ? charset : 'utf8mb4';
    await req.pool.query(
      `CREATE DATABASE ${quoteId(name)} CHARACTER SET ${cs}`
    );
    res.json({ ok: true });
  }));

  // Drop a database.
  router.delete('/databases/:db', asyncHandler(async (req, res) => {
    await req.pool.query(`DROP DATABASE ${quoteId(req.params.db)}`);
    res.json({ ok: true });
  }));

  // Drop a table.
  router.delete('/databases/:db/tables/:table', asyncHandler(async (req, res) => {
    const { db, table } = req.params;
    await req.pool.query(`DROP TABLE ${quoteId(db)}.${quoteId(table)}`);
    res.json({ ok: true });
  }));

  // Truncate (empty) a table.
  router.post('/databases/:db/tables/:table/truncate', asyncHandler(async (req, res) => {
    const { db, table } = req.params;
    await req.pool.query(`TRUNCATE TABLE ${quoteId(db)}.${quoteId(table)}`);
    res.json({ ok: true });
  }));

  return router;
};
