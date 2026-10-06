const { randomUUID } = require('crypto');
const db = require('./connection');

// Total stock currently available for a product, summed across all locations.
function getAvailableStock(productId) {
  const row = db.prepare(
    'SELECT COALESCE(SUM(quantity), 0) AS total FROM product_stock WHERE product_id = ?'
  ).get(productId);
  return row.total;
}

// Breakdown of stock per warehouse location for a product.
function getStockByLocation(productId) {
  return db.prepare(`
    SELECT ps.location_id, wl.label, wl.zone, wl.shelf, wl.level, wl.box, ps.quantity
    FROM product_stock ps
    JOIN warehouse_locations wl ON wl.id = ps.location_id
    WHERE ps.product_id = ? AND ps.quantity > 0
    ORDER BY ps.quantity DESC
  `).all(productId);
}

// Take `qty` units of a product out of stock (largest locations first),
// logging one stock_movements row per location touched.
// Throws an Error if there isn't enough stock available.
function allocateStock(productId, qty, orderId, reason) {
  const available = getAvailableStock(productId);
  if (qty > available) {
    const err = new Error(`Insufficient stock: requested ${qty}, available ${available}`);
    err.code = 'INSUFFICIENT_STOCK';
    throw err;
  }

  const locations = db.prepare(`
    SELECT id AS stock_row_id, location_id, quantity FROM product_stock
    WHERE product_id = ? AND quantity > 0
    ORDER BY quantity DESC
  `).all(productId);

  const updateStock = db.prepare('UPDATE product_stock SET quantity = quantity - ? WHERE id = ?');
  const insertMovement = db.prepare(`
    INSERT INTO stock_movements (id, product_id, location_id, change_qty, reason, order_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  let remaining = qty;
  for (const loc of locations) {
    if (remaining <= 0) break;
    const take = Math.min(loc.quantity, remaining);
    updateStock.run(take, loc.stock_row_id);
    insertMovement.run(randomUUID(), productId, loc.location_id, -take, reason, orderId);
    remaining -= take;
  }
}

// Put `qty` units of a product back into stock, reversing the most recent
// allocation(s) made for this order/product first (so it goes back to the
// same shelf it was taken from wherever possible).
function releaseStock(productId, qty, orderId, reason) {
  const priorMovements = db.prepare(`
    SELECT id, location_id, change_qty FROM stock_movements
    WHERE product_id = ? AND order_id = ? AND change_qty < 0
    ORDER BY created_at DESC
  `).all(productId, orderId);

  const updateStock = db.prepare(
    'UPDATE product_stock SET quantity = quantity + ? WHERE product_id = ? AND location_id = ?'
  );
  const insertMovement = db.prepare(`
    INSERT INTO stock_movements (id, product_id, location_id, change_qty, reason, order_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `);

  let remaining = qty;
  for (const mv of priorMovements) {
    if (remaining <= 0) break;
    const takenHere = Math.abs(mv.change_qty);
    const giveBack = Math.min(takenHere, remaining);
    updateStock.run(giveBack, productId, mv.location_id);
    insertMovement.run(randomUUID(), productId, mv.location_id, giveBack, reason, orderId);
    remaining -= giveBack;
  }

  // Fallback: if we still have leftover to return (shouldn't normally happen),
  // dump it back into whatever location currently holds this product, or the
  // first warehouse location as a last resort, so no stock is silently lost.
  if (remaining > 0) {
    const anyLocation = db.prepare('SELECT location_id FROM product_stock WHERE product_id = ? LIMIT 1').get(productId)
      || db.prepare('SELECT id AS location_id FROM warehouse_locations LIMIT 1').get();
    updateStock.run(remaining, productId, anyLocation.location_id);
    insertMovement.run(randomUUID(), productId, anyLocation.location_id, remaining, reason, orderId);
  }
}

module.exports = { getAvailableStock, getStockByLocation, allocateStock, releaseStock };
