const express = require('express');
const db = require('../db/connection');

const router = express.Router();

const PERIOD_SQL = {
  day: "datetime('now', '-1 day')",
  week: "datetime('now', '-7 day')",
  month: "datetime('now', '-1 month')",
  year: "datetime('now', '-1 year')"
};

// GET /api/dashboard/summary?period=day|week|month|year
router.get('/summary', (req, res) => {
  const period = PERIOD_SQL[req.query.period] ? req.query.period : 'month';
  const since = PERIOD_SQL[period];

  const totals = db.prepare(`
    SELECT COALESCE(SUM(oi.quantity * oi.unit_price_at_order), 0) AS total_revenue,
           COALESCE(SUM(oi.quantity), 0) AS total_items_sold,
           COUNT(DISTINCT o.id) AS total_orders
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id AND oi.is_cancelled = 0
    WHERE o.status IN ('confirmed', 'edited') AND o.confirmed_at >= ${since}
  `).get();

  const topProducts = db.prepare(`
    SELECT p.sku, b.name AS brand_name, m.name AS model_name, pt.name AS part_type_name,
           SUM(oi.quantity) AS units_sold, SUM(oi.quantity * oi.unit_price_at_order) AS revenue
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN products p ON p.id = oi.product_id
    JOIN brands b ON b.id = p.brand_id
    JOIN phone_models m ON m.id = p.phone_model_id
    JOIN part_types pt ON pt.id = p.part_type_id
    WHERE o.status IN ('confirmed', 'edited') AND oi.is_cancelled = 0 AND o.confirmed_at >= ${since}
    GROUP BY p.id
    ORDER BY units_sold DESC
    LIMIT 10
  `).all();

  const topCustomers = db.prepare(`
    SELECT cu.id, cu.name, cu.phone,
           COUNT(DISTINCT o.id) AS order_count,
           SUM(oi.quantity * oi.unit_price_at_order) AS total_spent
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id AND oi.is_cancelled = 0
    JOIN customers cu ON cu.id = o.customer_id
    WHERE o.status IN ('confirmed', 'edited') AND o.confirmed_at >= ${since}
    GROUP BY cu.id
    ORDER BY total_spent DESC
    LIMIT 10
  `).all();

  res.json({ period, totals, topProducts, topCustomers });
});

// GET /api/dashboard/low-stock
router.get('/low-stock', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT p.id, p.sku, p.min_stock_level,
             b.name AS brand_name, m.name AS model_name, pt.name AS part_type_name,
             qg.name AS quality_grade_name, c.name AS color_name,
             COALESCE((SELECT SUM(quantity) FROM product_stock ps WHERE ps.product_id = p.id), 0) AS total_stock
      FROM products p
      JOIN brands b ON b.id = p.brand_id
      JOIN phone_models m ON m.id = p.phone_model_id
      JOIN part_types pt ON pt.id = p.part_type_id
      LEFT JOIN quality_grades qg ON qg.id = p.quality_grade_id
      LEFT JOIN colors c ON c.id = p.color_id
      WHERE p.is_active = 1
    ) t
    WHERE t.total_stock <= t.min_stock_level
    ORDER BY t.total_stock ASC
  `).all();
  res.json(rows);
});

module.exports = router;
