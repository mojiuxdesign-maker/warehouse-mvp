const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../db/connection');
const { getStockByLocation, getAvailableStock } = require('../db/stock');

const router = express.Router();

const PRODUCT_SELECT = `
  SELECT
    p.id, p.sku, p.sale_price, p.purchase_price, p.min_stock_level, p.notes, p.is_active,
    b.id AS brand_id, b.name AS brand_name,
    m.id AS model_id, m.name AS model_name,
    pt.id AS part_type_id, pt.name AS part_type_name,
    qg.id AS quality_grade_id, qg.name AS quality_grade_name,
    c.id AS color_id, c.name AS color_name,
    COALESCE((SELECT SUM(quantity) FROM product_stock ps WHERE ps.product_id = p.id), 0) AS total_stock
  FROM products p
  JOIN brands b ON b.id = p.brand_id
  JOIN phone_models m ON m.id = p.phone_model_id
  JOIN part_types pt ON pt.id = p.part_type_id
  LEFT JOIN quality_grades qg ON qg.id = p.quality_grade_id
  LEFT JOIN colors c ON c.id = p.color_id
`;

// GET /api/products?search=&brand_id=&model_id=&part_type_id=&low_stock=1&page=1&limit=50
router.get('/', (req, res) => {
  const { search, brand_id, model_id, part_type_id, low_stock, page = 1, limit = 50 } = req.query;

  const clauses = ['p.is_active = 1'];
  const params = [];

  if (search) {
    clauses.push(`(
      p.sku LIKE ? OR b.name LIKE ? OR m.name LIKE ? OR pt.name LIKE ?
      OR qg.name LIKE ? OR c.name LIKE ?
    )`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like);
  }
  if (brand_id) { clauses.push('p.brand_id = ?'); params.push(brand_id); }
  if (model_id) { clauses.push('p.phone_model_id = ?'); params.push(model_id); }
  if (part_type_id) { clauses.push('p.part_type_id = ?'); params.push(part_type_id); }

  let sql = PRODUCT_SELECT + ' WHERE ' + clauses.join(' AND ');
  if (low_stock === '1') {
    sql = `SELECT * FROM (${sql}) t WHERE t.total_stock <= (SELECT min_stock_level FROM products WHERE id = t.id)`;
  }

  const countSql = `SELECT COUNT(*) AS cnt FROM (${sql})`;
  const total = db.prepare(countSql).get(...params).cnt;

  const offset = (Number(page) - 1) * Number(limit);
  sql += ' ORDER BY b.name, m.name, pt.name LIMIT ? OFFSET ?';
  const rows = db.prepare(sql).all(...params, Number(limit), offset);

  res.json({ data: rows, total, page: Number(page), limit: Number(limit) });
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  const product = db.prepare(PRODUCT_SELECT + ' WHERE p.id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  product.locations = getStockByLocation(product.id);
  res.json(product);
});

// POST /api/products
router.post('/', (req, res) => {
  const {
    sku, brand_id, phone_model_id, part_type_id, quality_grade_id, color_id,
    sale_price, purchase_price, min_stock_level, notes,
    initial_quantity, location_id
  } = req.body;

  if (!brand_id || !phone_model_id || !part_type_id || sale_price == null) {
    return res.status(400).json({ error: 'brand_id, phone_model_id, part_type_id and sale_price are required' });
  }

  const id = randomUUID();
  const finalSku = sku || `SKU-${id.slice(0, 8).toUpperCase()}`;

  const insert = db.transaction(() => {
    db.prepare(`
      INSERT INTO products
        (id, sku, brand_id, phone_model_id, part_type_id, quality_grade_id, color_id,
         sale_price, purchase_price, min_stock_level, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, finalSku, brand_id, phone_model_id, part_type_id,
      quality_grade_id || null, color_id || null,
      sale_price, purchase_price || null, min_stock_level ?? 10, notes || null
    );

    if (initial_quantity && location_id) {
      const stockId = randomUUID();
      db.prepare('INSERT INTO product_stock (id, product_id, location_id, quantity) VALUES (?, ?, ?, ?)')
        .run(stockId, id, location_id, initial_quantity);
      db.prepare(`
        INSERT INTO stock_movements (id, product_id, location_id, change_qty, reason, note, created_at)
        VALUES (?, ?, ?, ?, 'initial', 'Initial stock on product creation', datetime('now'))
      `).run(randomUUID(), id, location_id, initial_quantity);
    }
  });

  try {
    insert();
    res.status(201).json({ id, sku: finalSku });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'SKU already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/products/:id
router.put('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found' });

  const fields = ['sku', 'brand_id', 'phone_model_id', 'part_type_id', 'quality_grade_id',
    'color_id', 'sale_price', 'purchase_price', 'min_stock_level', 'notes'];
  const updates = [];
  const params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      updates.push(`${f} = ?`);
      params.push(req.body[f]);
    }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  updates.push("updated_at = datetime('now')");
  params.push(req.params.id);

  try {
    db.prepare(`UPDATE products SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ ok: true });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'SKU already exists' });
    }
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/products/:id  (soft delete)
router.delete('/:id', (req, res) => {
  const result = db.prepare("UPDATE products SET is_active = 0, updated_at = datetime('now') WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true });
});

// POST /api/products/:id/stock  -> manual stock adjustment (admin)
router.post('/:id/stock', (req, res) => {
  const { location_id, quantity_change, note } = req.body;
  if (!location_id || quantity_change == null) {
    return res.status(400).json({ error: 'location_id and quantity_change are required' });
  }
  const productId = req.params.id;

  const adjust = db.transaction(() => {
    const existingStock = db.prepare(
      'SELECT * FROM product_stock WHERE product_id = ? AND location_id = ?'
    ).get(productId, location_id);

    if (existingStock) {
      const newQty = existingStock.quantity + Number(quantity_change);
      if (newQty < 0) throw new Error('Resulting stock cannot be negative');
      db.prepare('UPDATE product_stock SET quantity = ? WHERE id = ?').run(newQty, existingStock.id);
    } else {
      if (Number(quantity_change) < 0) throw new Error('Resulting stock cannot be negative');
      db.prepare('INSERT INTO product_stock (id, product_id, location_id, quantity) VALUES (?, ?, ?, ?)')
        .run(randomUUID(), productId, location_id, quantity_change);
    }

    db.prepare(`
      INSERT INTO stock_movements (id, product_id, location_id, change_qty, reason, note, created_at)
      VALUES (?, ?, ?, ?, 'manual_adjustment', ?, datetime('now'))
    `).run(randomUUID(), productId, location_id, quantity_change, note || null);
  });

  try {
    adjust();
    res.json({ ok: true, total_stock: getAvailableStock(productId) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
