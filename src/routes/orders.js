const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db/connection');
const { allocateStock, releaseStock, getAvailableStock } = require('../db/stock');

const router = express.Router();

const ITEMS_SELECT = `
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
  ORDER BY oi.created_at
`;

function loadOrder(orderId) {
  const order = db.prepare(`
    SELECT o.*, cu.name AS customer_name, cu.phone AS customer_phone
    FROM orders o LEFT JOIN customers cu ON cu.id = o.customer_id
    WHERE o.id = ?
  `).get(orderId);
  if (!order) return null;
  order.items = db.prepare(ITEMS_SELECT).all(orderId);
  order.total_amount = order.items
    .filter(i => !i.is_cancelled)
    .reduce((sum, i) => sum + i.quantity * i.unit_price_at_order, 0);
  order.total_items = order.items
    .filter(i => !i.is_cancelled)
    .reduce((sum, i) => sum + i.quantity, 0);
  return order;
}

// GET /api/orders?status=&customer_id=
router.get('/', (req, res) => {
  const { status, customer_id } = req.query;
  const clauses = [];
  const params = [];
  if (status) { clauses.push('o.status = ?'); params.push(status); }
  if (customer_id) { clauses.push('o.customer_id = ?'); params.push(customer_id); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';

  const orders = db.prepare(`
    SELECT o.id, o.order_number, o.status, o.channel, o.created_at, o.confirmed_at,
           cu.name AS customer_name, cu.phone AS customer_phone
    FROM orders o LEFT JOIN customers cu ON cu.id = o.customer_id
    ${where}
    ORDER BY o.created_at DESC
  `).all(...params);

  const totalStmt = db.prepare(`
    SELECT COALESCE(SUM(quantity * unit_price_at_order), 0) AS total
    FROM order_items WHERE order_id = ? AND is_cancelled = 0
  `);
  for (const o of orders) o.total_amount = totalStmt.get(o.id).total;

  res.json(orders);
});

// GET /api/orders/:id
router.get('/:id', (req, res) => {
  const order = loadOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// GET /api/orders/:id/picking-list  (product + location + qty taken, for confirmed orders)
router.get('/:id/picking-list', (req, res) => {
  const rows = db.prepare(`
    SELECT p.sku, b.name AS brand_name, m.name AS model_name, pt.name AS part_type_name,
           qg.name AS quality_grade_name, c.name AS color_name,
           wl.label AS location_label, SUM(-sm.change_qty) AS quantity
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    JOIN brands b ON b.id = p.brand_id
    JOIN phone_models m ON m.id = p.phone_model_id
    JOIN part_types pt ON pt.id = p.part_type_id
    LEFT JOIN quality_grades qg ON qg.id = p.quality_grade_id
    LEFT JOIN colors c ON c.id = p.color_id
    LEFT JOIN warehouse_locations wl ON wl.id = sm.location_id
    WHERE sm.order_id = ? AND sm.change_qty < 0
    GROUP BY p.id, wl.id
    ORDER BY b.name, m.name
  `).all(req.params.id);
  res.json(rows);
});

// POST /api/orders  -> create a new draft order
// body: { customer_id } OR { customer_name, customer_phone } to create customer inline, channel?
router.post('/', (req, res) => {
  const { customer_id, customer_name, customer_phone, channel } = req.body;

  let finalCustomerId = customer_id || null;
  if (!finalCustomerId && (customer_name || customer_phone)) {
    finalCustomerId = randomUUID();
    db.prepare('INSERT INTO customers (id, name, phone) VALUES (?, ?, ?)')
      .run(finalCustomerId, customer_name || null, customer_phone || null);
  }

  const id = randomUUID();
  const maxNum = db.prepare('SELECT COALESCE(MAX(order_number), 0) AS m FROM orders').get().m;

  db.prepare(`
    INSERT INTO orders (id, order_number, customer_id, status, channel, created_at, updated_at)
    VALUES (?, ?, ?, 'draft', ?, datetime('now'), datetime('now'))
  `).run(id, maxNum + 1, finalCustomerId, channel || 'manual');

  res.status(201).json(loadOrder(id));
});

// POST /api/orders/:id/items  -> add a line item
// body: { product_id, quantity }
router.post('/:id/items', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status === 'cancelled') return res.status(400).json({ error: 'Order is cancelled' });

  const { product_id, quantity } = req.body;
  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'product_id and a positive quantity are required' });
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });

  const wasConfirmed = order.status === 'confirmed' || order.status === 'edited';

  const run = db.transaction(() => {
    if (wasConfirmed) {
      allocateStock(product_id, quantity, order.id, 'order_edited');
      db.prepare("UPDATE orders SET status = 'edited', updated_at = datetime('now') WHERE id = ?").run(order.id);
    } else {
      db.prepare("UPDATE orders SET updated_at = datetime('now') WHERE id = ?").run(order.id);
    }
    const itemId = randomUUID();
    db.prepare(`
      INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_at_order, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(itemId, order.id, product_id, quantity, product.sale_price);
    return itemId;
  });

  try {
    const itemId = run();
    res.status(201).json(loadOrder(order.id));
  } catch (e) {
    if (e.code === 'INSUFFICIENT_STOCK') return res.status(409).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/orders/:id/items/:itemId  -> change quantity
router.put('/:id/items/:itemId', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(req.params.itemId, order.id);
  if (!item) return res.status(404).json({ error: 'Order item not found' });

  const { quantity } = req.body;
  if (!quantity || quantity <= 0) return res.status(400).json({ error: 'A positive quantity is required' });

  const wasConfirmed = order.status === 'confirmed' || order.status === 'edited';
  const diff = quantity - item.quantity;

  const run = db.transaction(() => {
    if (wasConfirmed && diff !== 0) {
      if (diff > 0) {
        allocateStock(item.product_id, diff, order.id, 'order_edited');
      } else {
        releaseStock(item.product_id, -diff, order.id, 'order_edited');
      }
      db.prepare("UPDATE orders SET status = 'edited', updated_at = datetime('now') WHERE id = ?").run(order.id);
    }
    db.prepare('UPDATE order_items SET quantity = ? WHERE id = ?').run(quantity, item.id);
  });

  try {
    run();
    res.json(loadOrder(order.id));
  } catch (e) {
    if (e.code === 'INSUFFICIENT_STOCK') return res.status(409).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/orders/:id/items/:itemId  -> remove/cancel a single line item
router.delete('/:id/items/:itemId', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const item = db.prepare('SELECT * FROM order_items WHERE id = ? AND order_id = ?').get(req.params.itemId, order.id);
  if (!item) return res.status(404).json({ error: 'Order item not found' });
  if (item.is_cancelled) return res.status(400).json({ error: 'Item already cancelled' });

  const wasConfirmed = order.status === 'confirmed' || order.status === 'edited';

  const run = db.transaction(() => {
    if (wasConfirmed) {
      releaseStock(item.product_id, item.quantity, order.id, 'order_edited');
      db.prepare("UPDATE orders SET status = 'edited', updated_at = datetime('now') WHERE id = ?").run(order.id);
    }
    db.prepare('UPDATE order_items SET is_cancelled = 1 WHERE id = ?').run(item.id);
  });

  run();
  res.json(loadOrder(order.id));
});

// POST /api/orders/:id/confirm
router.post('/:id/confirm', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'draft') return res.status(400).json({ error: `Order is already ${order.status}` });

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? AND is_cancelled = 0').all(order.id);
  if (items.length === 0) return res.status(400).json({ error: 'Cannot confirm an order with no items' });

  const run = db.transaction(() => {
    for (const item of items) {
      allocateStock(item.product_id, item.quantity, order.id, 'order_confirmed');
    }
    db.prepare(`
      UPDATE orders SET status = 'confirmed', confirmed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(order.id);
  });

  try {
    run();
    res.json(loadOrder(order.id));
  } catch (e) {
    if (e.code === 'INSUFFICIENT_STOCK') return res.status(409).json({ error: e.message });
    res.status(500).json({ error: e.message });
  }
});

// POST /api/orders/:id/cancel  -> cancel the whole order, restoring any allocated stock
router.post('/:id/cancel', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status === 'cancelled') return res.status(400).json({ error: 'Order already cancelled' });

  const wasConfirmed = order.status === 'confirmed' || order.status === 'edited';
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? AND is_cancelled = 0').all(order.id);

  const run = db.transaction(() => {
    if (wasConfirmed) {
      for (const item of items) {
        releaseStock(item.product_id, item.quantity, order.id, 'order_cancelled');
      }
    }
    db.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(order.id);
  });

  run();
  res.json(loadOrder(order.id));
});

module.exports = router;
