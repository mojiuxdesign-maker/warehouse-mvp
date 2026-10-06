const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db/connection');

const router = express.Router();

// ---- Brands ----
router.get('/brands', (req, res) => {
  res.json(db.prepare('SELECT * FROM brands ORDER BY name').all());
});
router.post('/brands', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = randomUUID();
  db.prepare('INSERT INTO brands (id, name) VALUES (?, ?)').run(id, name);
  res.status(201).json({ id, name });
});

// ---- Phone models (optionally filtered by brand_id) ----
router.get('/models', (req, res) => {
  const { brand_id } = req.query;
  const rows = brand_id
    ? db.prepare('SELECT * FROM phone_models WHERE brand_id = ? ORDER BY name').all(brand_id)
    : db.prepare('SELECT * FROM phone_models ORDER BY name').all();
  res.json(rows);
});
router.post('/models', (req, res) => {
  const { brand_id, name } = req.body;
  if (!brand_id || !name) return res.status(400).json({ error: 'brand_id and name are required' });
  const id = randomUUID();
  db.prepare('INSERT INTO phone_models (id, brand_id, name) VALUES (?, ?, ?)').run(id, brand_id, name);
  res.status(201).json({ id, brand_id, name });
});

// ---- Part types ----
router.get('/part-types', (req, res) => {
  res.json(db.prepare('SELECT * FROM part_types ORDER BY name').all());
});
router.post('/part-types', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = randomUUID();
  db.prepare('INSERT INTO part_types (id, name) VALUES (?, ?)').run(id, name);
  res.status(201).json({ id, name });
});

// ---- Quality grades ----
router.get('/quality-grades', (req, res) => {
  res.json(db.prepare('SELECT * FROM quality_grades ORDER BY sort_order').all());
});
router.post('/quality-grades', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = randomUUID();
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM quality_grades').get().m;
  db.prepare('INSERT INTO quality_grades (id, name, sort_order) VALUES (?, ?, ?)').run(id, name, maxOrder + 1);
  res.status(201).json({ id, name });
});

// ---- Colors ----
router.get('/colors', (req, res) => {
  res.json(db.prepare('SELECT * FROM colors ORDER BY name').all());
});
router.post('/colors', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = randomUUID();
  db.prepare('INSERT INTO colors (id, name) VALUES (?, ?)').run(id, name);
  res.status(201).json({ id, name });
});

// ---- Warehouse locations ----
router.get('/locations', (req, res) => {
  res.json(db.prepare('SELECT * FROM warehouse_locations ORDER BY zone, shelf, level, box').all());
});
router.post('/locations', (req, res) => {
  const { zone, shelf, level, box } = req.body;
  if (!zone || !shelf || !level || !box) {
    return res.status(400).json({ error: 'zone, shelf, level, box are required' });
  }
  const id = randomUUID();
  const label = `${zone}-${shelf}-${level}-${box}`;
  try {
    db.prepare('INSERT INTO warehouse_locations (id, zone, shelf, level, box, label) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, zone, shelf, level, box, label);
    res.status(201).json({ id, zone, shelf, level, box, label });
  } catch (e) {
    res.status(409).json({ error: 'This exact location already exists' });
  }
});

module.exports = router;
