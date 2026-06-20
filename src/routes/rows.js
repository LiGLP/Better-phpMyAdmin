'use strict';

const express = require('express');
const { asyncHandler, requireAuth, quoteId } = require('../util');

module.exports = function rowRoutes(config) {
  const router = express.Router();
  router.use(requireAuth);

  const perPageDefault = config.limits.rowsPerPage || 50;

  async function primaryKey(pool, db, table) {
    const [rows] = await pool.query(
      `SELECT COLUMN_NAME AS name FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = 'PRIMARY'
        ORDER BY SEQ_IN_INDEX`,
      [db, table]
    );
    return rows.map(r => r.name);
  }

  // Browse rows with pagination, optional sort and simple per-column search.
  router.get('/databases/:db/tables/:table/rows', asyncHandler(async (req, res) => {
    const { db, table } = req.params;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(500, parseInt(req.query.perPage, 10) || perPageDefault);
    const offset = (page - 1) * perPage;

    const tbl = `${quoteId(db)}.${quoteId(table)}`;

    // Validate sort column against the real column list.
    const [colRows] = await req.pool.query(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
      [db, table]
    );
    const columns = colRows.map(c => c.name);

    let orderClause = '';
    if (req.query.sort && columns.includes(req.query.sort)) {
      const dir = String(req.query.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
      orderClause = ` ORDER BY ${quoteId(req.query.sort)} ${dir}`;
    }

    // Optional global search: matches any column via OR LIKE.
    let whereClause = '';
    const params = [];
    if (req.query.search) {
      const like = '%' + req.query.search + '%';
      const ors = columns.map(c => `CAST(${quoteId(c)} AS CHAR) LIKE ?`);
      whereClause = ' WHERE ' + ors.join(' OR ');
      columns.forEach(() => params.push(like));
    }

    const [countRows] = await req.pool.query(
      `SELECT COUNT(*) AS total FROM ${tbl}${whereClause}`, params
    );
    const total = Number(countRows[0].total);

    const [rows] = await req.pool.query(
      `SELECT * FROM ${tbl}${whereClause}${orderClause} LIMIT ? OFFSET ?`,
      [...params, perPage, offset]
    );

    const pk = await primaryKey(req.pool, db, table);
    res.json({ columns, rows, total, page, perPage, primaryKey: pk });
  }));

  // Insert a row.
  router.post('/databases/:db/tables/:table/rows', asyncHandler(async (req, res) => {
    const { db, table } = req.params;
    const values = req.body && req.body.values;
    if (!values || typeof values !== 'object') {
      return res.status(400).json({ error: 'Missing values' });
    }
    const keys = Object.keys(values);
    if (keys.length === 0) return res.status(400).json({ error: 'No columns provided' });
    const cols = keys.map(quoteId).join(', ');
    const placeholders = keys.map(() => '?').join(', ');
    const params = keys.map(k => values[k]);
    const [result] = await req.pool.query(
      `INSERT INTO ${quoteId(db)}.${quoteId(table)} (${cols}) VALUES (${placeholders})`,
      params
    );
    res.json({ ok: true, insertId: result.insertId, affectedRows: result.affectedRows });
  }));

  // Update a row identified by its primary key (or full-row match as fallback).
  router.put('/databases/:db/tables/:table/rows', asyncHandler(async (req, res) => {
    const { db, table } = req.params;
    const { values, where } = req.body || {};
    if (!values || !where || typeof values !== 'object' || typeof where !== 'object') {
      return res.status(400).json({ error: 'Missing values or where clause' });
    }
    const setKeys = Object.keys(values);
    const whereKeys = Object.keys(where);
    if (setKeys.length === 0 || whereKeys.length === 0) {
      return res.status(400).json({ error: 'Empty update' });
    }
    const setClause = setKeys.map(k => `${quoteId(k)} = ?`).join(', ');
    const whereClause = whereKeys.map(k => `${quoteId(k)} = ?`).join(' AND ');
    const params = [...setKeys.map(k => values[k]), ...whereKeys.map(k => where[k])];
    const [result] = await req.pool.query(
      `UPDATE ${quoteId(db)}.${quoteId(table)} SET ${setClause} WHERE ${whereClause} LIMIT 1`,
      params
    );
    res.json({ ok: true, affectedRows: result.affectedRows });
  }));

  // Delete a row identified by an exact column match map.
  router.delete('/databases/:db/tables/:table/rows', asyncHandler(async (req, res) => {
    const { db, table } = req.params;
    const where = req.body && req.body.where;
    if (!where || typeof where !== 'object' || Object.keys(where).length === 0) {
      return res.status(400).json({ error: 'Missing where clause' });
    }
    const whereKeys = Object.keys(where);
    const whereClause = whereKeys.map(k => `${quoteId(k)} = ?`).join(' AND ');
    const params = whereKeys.map(k => where[k]);
    const [result] = await req.pool.query(
      `DELETE FROM ${quoteId(db)}.${quoteId(table)} WHERE ${whereClause} LIMIT 1`,
      params
    );
    res.json({ ok: true, affectedRows: result.affectedRows });
  }));

  return router;
};
