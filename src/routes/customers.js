const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db/connection');

const router = express.Router();

// GET /api/customers?search=
router.get('/', (req, res) => {
  const { search } = req.query;
  let rows;
  if (search) {
    const like = `%${search}%`;
    rows = db.prepare(
      'SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name LIMIT 50'
    ).all(like, like);
  } else {
    rows = db.prepare('SELECT * FROM customers ORDER BY created_at DESC LIMIT 50').all();
  }
  res.json(rows);
});

// POST /api/customers
router.post('/', (req, res) => {
  const { name, phone } = req.body;
  if (!name && !phone) return res.status(400).json({ error: 'name or phone is required' });
  const id = randomUUID();
  db.prepare('INSERT INTO customers (id, name, phone) VALUES (?, ?, ?)').run(id, name || null, phone || null);
  res.status(201).json({ id, name, phone });
});

// GET /api/customers/:id/orders  -> order history for "repeat this order" feature
router.get('/:id/orders', (req, res) => {
  const orders = db.prepare(`
    SELECT id, order_number, status, channel, created_at, confirmed_at
    FROM orders WHERE customer_id = ? ORDER BY created_at DESC
  `).all(req.params.id);

  const itemsStmt = db.prepare(`
    SELECT oi.id, oi.product_id, oi.quantity, oi.unit_price_at_order, oi.is_cancelled,
           p.sku, b.name AS brand_name, m.name AS model_name, pt.name AS part_type_name,
           qg.name AS quality_grade_name, c.name AS color_name
    FROM order_items oi
    JOIN products p ON p.id = oi.product_id
    JOIN brands b ON b.id = p.brand_id
    JOIN phone_models m ON m.id = p.phone_model_id
    JOIN part_types pt ON pt.id = p.part_type_id
    LEFT JOIN quality_grades qg ON qg.id = p.quality_grade_id
    LEFT JOIN colors c ON c.id = p.color_id
    WHERE oi.order_id = ?
  `);

  for (const order of orders) {
    order.items = itemsStmt.all(order.id);
  }
  res.json(orders);
});

module.exports = router;
