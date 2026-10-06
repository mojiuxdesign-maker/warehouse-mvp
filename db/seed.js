// ============================================================
// Seed script: creates the SQLite DB from schema.sql, then fills
// it with realistic reference data + ~500 mock smartphone-parts
// products, warehouse locations, and one demo order.
// ============================================================

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'warehouse.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Start fresh every time this script runs
if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);

const db = new Database(DB_PATH);
db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));

function uid() { return randomUUID(); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function pickSome(arr, min, max) {
  const n = Math.min(arr.length, Math.floor(Math.random() * (max - min + 1)) + min);
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}
function round2(n) { return Math.round(n * 100) / 100; }

// ---------------------------------------------------------------
// 1. Brands & phone models
// ---------------------------------------------------------------
const brandsData = {
  Apple: [
    'iPhone 11', 'iPhone 11 Pro', 'iPhone 12', 'iPhone 12 Pro', 'iPhone 13',
    'iPhone 13 Pro', 'iPhone 14', 'iPhone 14 Pro', 'iPhone 15', 'iPhone 15 Pro',
    'iPhone 16', 'iPhone 16 Pro'
  ],
  Samsung: [
    'Galaxy S21', 'Galaxy S21+', 'Galaxy S22', 'Galaxy S22+', 'Galaxy S23',
    'Galaxy S23+', 'Galaxy S24', 'Galaxy S24 Ultra', 'Galaxy A54', 'Galaxy A34',
    'Galaxy A14', 'Galaxy Note 20'
  ],
  Google: [
    'Pixel 6', 'Pixel 6 Pro', 'Pixel 7', 'Pixel 7 Pro', 'Pixel 8',
    'Pixel 8 Pro', 'Pixel 8a', 'Pixel 9', 'Pixel 9 Pro'
  ]
};

const brandIds = {};
const insertBrand = db.prepare('INSERT INTO brands (id, name) VALUES (?, ?)');
for (const brand of Object.keys(brandsData)) {
  const id = uid();
  brandIds[brand] = id;
  insertBrand.run(id, brand);
}

const modelRows = []; // { id, brandName, brandId, name }
const insertModel = db.prepare('INSERT INTO phone_models (id, brand_id, name) VALUES (?, ?, ?)');
for (const [brand, models] of Object.entries(brandsData)) {
  for (const model of models) {
    const id = uid();
    insertModel.run(id, brandIds[brand], model);
    modelRows.push({ id, brandName: brand, brandId: brandIds[brand], name: model });
  }
}

// ---------------------------------------------------------------
// 2. Part types (with base price range and whether color/quality applies)
// ---------------------------------------------------------------
const partTypesData = [
  { name: 'Display / Touch Screen', priceMin: 45, priceMax: 130, hasColor: false, hasQuality: true },
  { name: 'Battery', priceMin: 14, priceMax: 32, hasColor: false, hasQuality: true },
  { name: 'Back Glass / Housing', priceMin: 10, priceMax: 35, hasColor: true, hasQuality: true },
  { name: 'Front Camera', priceMin: 9, priceMax: 28, hasColor: false, hasQuality: true },
  { name: 'Rear Camera Module', priceMin: 18, priceMax: 55, hasColor: false, hasQuality: true },
  { name: 'Charging Port Flex Cable', priceMin: 6, priceMax: 16, hasColor: false, hasQuality: false },
  { name: 'Loudspeaker', priceMin: 5, priceMax: 14, hasColor: false, hasQuality: false },
  { name: 'Earpiece Speaker', priceMin: 4, priceMax: 10, hasColor: false, hasQuality: false },
  { name: 'Vibration Motor', priceMin: 3, priceMax: 8, hasColor: false, hasQuality: false },
  { name: 'Power Button Flex', priceMin: 3, priceMax: 9, hasColor: false, hasQuality: false },
  { name: 'Volume Button Flex', priceMin: 3, priceMax: 9, hasColor: false, hasQuality: false },
  { name: 'SIM Tray', priceMin: 2, priceMax: 6, hasColor: true, hasQuality: false }
];

const partTypeIds = {};
const insertPartType = db.prepare('INSERT INTO part_types (id, name) VALUES (?, ?)');
for (const pt of partTypesData) {
  const id = uid();
  partTypeIds[pt.name] = id;
  insertPartType.run(id, pt.name);
}

// ---------------------------------------------------------------
// 3. Quality grades (fixed list, optional per product)
// ---------------------------------------------------------------
const qualityGradesData = [
  'Original', 'High Quality', 'Good Quality', 'Medium Quality', 'Low Quality', 'Economic'
];
const qualityFactor = {
  'Original': 1.4, 'High Quality': 1.2, 'Good Quality': 1.0,
  'Medium Quality': 0.8, 'Low Quality': 0.6, 'Economic': 0.45
};
const qualityIds = {};
const insertQuality = db.prepare('INSERT INTO quality_grades (id, name, sort_order) VALUES (?, ?, ?)');
qualityGradesData.forEach((name, i) => {
  const id = uid();
  qualityIds[name] = id;
  insertQuality.run(id, name, i);
});

// ---------------------------------------------------------------
// 4. Colors (used for parts where hasColor = true)
// ---------------------------------------------------------------
const colorsData = ['Black', 'White', 'Gold', 'Silver', 'Blue', 'Green', 'Purple', 'Graphite', 'Midnight'];
const colorIds = {};
const insertColor = db.prepare('INSERT INTO colors (id, name) VALUES (?, ?)');
for (const c of colorsData) {
  const id = uid();
  colorIds[c] = id;
  insertColor.run(id, c);
}

const brandFactor = { Apple: 1.15, Samsung: 1.0, Google: 0.95 };

// ---------------------------------------------------------------
// 5. Warehouse locations (generate a pool, assign as we create products)
// ---------------------------------------------------------------
const zones = ['A', 'B', 'C', 'D', 'E'];
const shelves = ['1', '2', '3', '4', '5', '6'];
const levels = ['1', '2', '3', '4'];
const boxes = ['A', 'B', 'C', 'D', 'E', 'F'];

const insertLocation = db.prepare(
  'INSERT INTO warehouse_locations (id, zone, shelf, level, box, label) VALUES (?, ?, ?, ?, ?, ?)'
);
const locationCache = new Map(); // label -> id
function getOrCreateLocation() {
  const zone = pick(zones), shelf = pick(shelves), level = pick(levels), box = pick(boxes);
  const label = `${zone}-${shelf}-${level}-${box}`;
  if (locationCache.has(label)) return locationCache.get(label);
  const id = uid();
  insertLocation.run(id, zone, shelf, level, box, label);
  locationCache.set(label, id);
  return id;
}

// ---------------------------------------------------------------
// 6. Generate ~500 products by combining model x part_type x
//    (quality grade, if applicable) x (color, if applicable)
// ---------------------------------------------------------------
const insertProduct = db.prepare(`
  INSERT INTO products
    (id, sku, brand_id, phone_model_id, part_type_id, quality_grade_id, color_id,
     sale_price, purchase_price, min_stock_level, notes, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
`);
const insertStock = db.prepare(
  'INSERT INTO product_stock (id, product_id, location_id, quantity) VALUES (?, ?, ?, ?)'
);
const insertMovement = db.prepare(`
  INSERT INTO stock_movements (id, product_id, location_id, change_qty, reason, order_id, note, created_at)
  VALUES (?, ?, ?, ?, 'initial', NULL, 'Initial stock load (seed)', datetime('now'))
`);

function skuAbbrev(str) {
  return str.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
}

const skuCounters = {};
const productRows = []; // keep for later use (demo order)
let productCount = 0;
const TARGET = 500;

// Build the full candidate combination list first, then shuffle & trim to TARGET
const candidates = [];
for (const model of modelRows) {
  for (const pt of partTypesData) {
    const qualities = pt.hasQuality ? pickSome(qualityGradesData, 2, 4) : [null];
    const colorsForPart = pt.hasColor ? pickSome(colorsData, 1, 3) : [null];
    for (const q of qualities) {
      for (const c of colorsForPart) {
        candidates.push({ model, pt, quality: q, color: c });
      }
    }
  }
}

// shuffle candidates, take first TARGET
candidates.sort(() => Math.random() - 0.5);
const selected = candidates.slice(0, TARGET);

for (const cand of selected) {
  const { model, pt, quality, color } = cand;
  const base = pt.priceMin + Math.random() * (pt.priceMax - pt.priceMin);
  const qFactor = quality ? qualityFactor[quality] : 1.0;
  const bFactor = brandFactor[model.brandName];
  const salePrice = round2(base * qFactor * bFactor);
  const purchasePrice = round2(salePrice * (0.5 + Math.random() * 0.15)); // ~50-65% of sale price

  const brandAbbrev = skuAbbrev(model.brandName);
  const modelAbbrev = skuAbbrev(model.name);
  const partAbbrev = skuAbbrev(pt.name);
  const skuBase = `${brandAbbrev}-${modelAbbrev}-${partAbbrev}`;
  skuCounters[skuBase] = (skuCounters[skuBase] || 0) + 1;
  const sku = `${skuBase}-${String(skuCounters[skuBase]).padStart(3, '0')}`;

  const productId = uid();
  insertProduct.run(
    productId,
    sku,
    model.brandId,
    model.id,
    partTypeIds[pt.name],
    quality ? qualityIds[quality] : null,
    color ? colorIds[color] : null,
    salePrice,
    purchasePrice,
    5 + Math.floor(Math.random() * 26), // min_stock_level 5-30
    null
  );

  // Assign stock to 1 (mostly) or 2 (occasionally) warehouse locations
  const numLocations = Math.random() < 0.15 ? 2 : 1;
  let totalQty = 0;
  for (let i = 0; i < numLocations; i++) {
    const locId = getOrCreateLocation();
    const qty = Math.floor(Math.random() * 150); // 0-149 per location
    totalQty += qty;
    insertStock.run(uid(), productId, locId, qty);
    if (qty > 0) {
      insertMovement.run(uid(), productId, locId, qty);
    }
  }

  productRows.push({ id: productId, sku, salePrice, totalQty });
  productCount++;
}

// ---------------------------------------------------------------
// 7. A couple of suppliers (for the admin panel / future reorder flow)
// ---------------------------------------------------------------
const insertSupplier = db.prepare(
  'INSERT INTO suppliers (id, name, contact_info, country) VALUES (?, ?, ?, ?)'
);
insertSupplier.run(uid(), 'Shenzhen Mobile Parts Co.', 'sales@szmobileparts.example.com', 'China');
insertSupplier.run(uid(), 'Guangzhou Screen Supply', 'contact@gzscreens.example.com', 'China');
insertSupplier.run(uid(), 'EU Parts Distribution GmbH', 'info@euparts.example.de', 'Germany');

// ---------------------------------------------------------------
// 8. One demo customer + one demo confirmed order (so the UI has
//    something to show immediately, incl. customer order history)
// ---------------------------------------------------------------
const demoCustomerId = uid();
db.prepare('INSERT INTO customers (id, name, phone) VALUES (?, ?, ?)')
  .run(demoCustomerId, 'Repair Shop Berlin Mitte', '+49 151 2345678');

const demoOrderId = uid();
db.prepare(`
  INSERT INTO orders (id, order_number, customer_id, status, channel, created_at, updated_at, confirmed_at)
  VALUES (?, 1, ?, 'confirmed', 'manual', datetime('now'), datetime('now'), datetime('now'))
`).run(demoOrderId, demoCustomerId);

const demoItems = productRows.filter(p => p.totalQty > 20).slice(0, 4);
const insertOrderItem = db.prepare(`
  INSERT INTO order_items (id, order_id, product_id, quantity, unit_price_at_order)
  VALUES (?, ?, ?, ?, ?)
`);
const insertOrderMovement = db.prepare(`
  INSERT INTO stock_movements (id, product_id, location_id, change_qty, reason, order_id, note, created_at)
  VALUES (?, ?, ?, ?, 'order_confirmed', ?, 'Demo order #1', datetime('now'))
`);
const getProductLocations = db.prepare(`
  SELECT id, location_id, quantity FROM product_stock WHERE product_id = ? AND quantity > 0 ORDER BY quantity DESC
`);
const decrementStockRow = db.prepare('UPDATE product_stock SET quantity = quantity - ? WHERE id = ?');

for (const item of demoItems) {
  const qty = 5 + Math.floor(Math.random() * 20);
  insertOrderItem.run(uid(), demoOrderId, item.id, qty, item.salePrice);

  // Actually decrement real stock/location rows, same logic the live app uses,
  // so the demo order's picking list shows a real shelf location.
  let remaining = qty;
  for (const loc of getProductLocations.all(item.id)) {
    if (remaining <= 0) break;
    const take = Math.min(loc.quantity, remaining);
    decrementStockRow.run(take, loc.id);
    insertOrderMovement.run(uid(), item.id, loc.location_id, -take, demoOrderId);
    remaining -= take;
  }
}

console.log(`✔ Database created at ${DB_PATH}`);
console.log(`✔ Brands: ${Object.keys(brandsData).length}, Models: ${modelRows.length}, Part types: ${partTypesData.length}`);
console.log(`✔ Products generated: ${productCount}`);
console.log(`✔ Warehouse locations used: ${locationCache.size}`);
console.log(`✔ Demo customer + 1 confirmed demo order created`);

db.close();
