'use strict';

const express = require('express');
const multer = require('multer');
const { asyncHandler, requireAuth, quoteId } = require('../util');
const { rawConnection } = require('../db');

/** Render a single value as a SQL literal for dump output. */
function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (Buffer.isBuffer(value)) return '0x' + value.toString('hex');
  const str = String(value);
  const escaped = str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\0/g, '\\0')
    .replace(/\x1a/g, '\\Z');
  return "'" + escaped + "'";
}

/** Render a value for a CSV cell. */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  if (Buffer.isBuffer(value)) value = value.toString('base64');
  const str = String(value);
  if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

module.exports = function transferRoutes(config) {
  const router = express.Router();
  router.use(requireAuth);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: (config.limits.maxImportSizeMB || 64) * 1024 * 1024 }
  });

  // --- Export: SQL dump of a whole database or a single table ---
  router.get('/databases/:db/export', asyncHandler(async (req, res) => {
    const { db } = req.params;
    const onlyTable = req.query.table || null;
    const withData = req.query.data !== '0';
    const withDrop = req.query.drop === '1';

    const conn = await rawConnection(req.creds);
    try {
      await conn.query(`USE ${quoteId(db)}`);
      let tables;
      if (onlyTable) {
        tables = [onlyTable];
      } else {
        const [rows] = await conn.query(
          `SELECT TABLE_NAME AS name FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
          [db]
        );
        tables = rows.map(r => r.name);
      }

      const filename = (onlyTable ? `${db}.${onlyTable}` : db) +
        '_' + new Date().toISOString().slice(0, 10) + '.sql';
      res.setHeader('Content-Type', 'application/sql; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

      res.write(`-- Better phpMyAdmin SQL Dump\n`);
      res.write(`-- Database: ${db}\n`);
      res.write(`-- Generated: ${new Date().toISOString()}\n`);
      res.write(`SET FOREIGN_KEY_CHECKS=0;\nSET NAMES utf8mb4;\n\n`);

      for (const table of tables) {
        const [createRows] = await conn.query(`SHOW CREATE TABLE ${quoteId(table)}`);
        const createSql = createRows[0]['Create Table'] || createRows[0]['Create View'];
        res.write(`-- ----------------------------\n-- Table: ${table}\n-- ----------------------------\n`);
        if (withDrop) res.write(`DROP TABLE IF EXISTS ${quoteId(table)};\n`);
        res.write(createSql + ';\n\n');

        if (withData && createRows[0]['Create Table']) {
          const [colRows] = await conn.query(
            `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
            [db, table]
          );
          const colList = colRows.map(c => quoteId(c.name)).join(', ');
          const colNames = colRows.map(c => c.name);

          // Stream rows so large tables don't buffer entirely in memory.
          const stream = conn.connection.query(`SELECT * FROM ${quoteId(table)}`).stream();
          let batch = [];
          const flush = () => {
            if (batch.length === 0) return;
            res.write(`INSERT INTO ${quoteId(table)} (${colList}) VALUES\n`);
            res.write(batch.join(',\n') + ';\n');
            batch = [];
          };
          for await (const row of stream) {
            const vals = colNames.map(c => sqlLiteral(row[c])).join(', ');
            batch.push('(' + vals + ')');
            if (batch.length >= 200) flush();
          }
          flush();
          res.write('\n');
        }
      }
      res.write(`SET FOREIGN_KEY_CHECKS=1;\n`);
      res.end();
    } finally {
      await conn.end();
    }
  }));

  // --- Export: CSV of a single table ---
  router.get('/databases/:db/tables/:table/export.csv', asyncHandler(async (req, res) => {
    const { db, table } = req.params;
    const conn = await rawConnection(req.creds);
    try {
      const [colRows] = await conn.query(
        `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
        [db, table]
      );
      const cols = colRows.map(c => c.name);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${db}.${table}.csv"`);
      res.write(cols.map(csvCell).join(',') + '\r\n');

      const stream = conn.connection.query(
        `SELECT * FROM ${quoteId(db)}.${quoteId(table)}`
      ).stream();
      for await (const row of stream) {
        res.write(cols.map(c => csvCell(row[c])).join(',') + '\r\n');
      }
      res.end();
    } finally {
      await conn.end();
    }
  }));

  // --- Import: execute an uploaded .sql file ---
  router.post('/databases/import', upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const targetDb = req.body.db || null;
    const sql = req.file.buffer.toString('utf8');

    const conn = await rawConnection(req.creds, { multipleStatements: true });
    const started = Date.now();
    try {
      if (targetDb) await conn.query(`USE ${quoteId(targetDb)}`);
      await conn.query(sql);
      res.json({ ok: true, elapsedMs: Date.now() - started, bytes: req.file.size });
    } catch (err) {
      res.status(400).json({ error: err.message, code: err.code, sqlState: err.sqlState });
    } finally {
      await conn.end();
    }
  }));

  return router;
};
