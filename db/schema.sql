-- ============================================================
-- Warehouse Management MVP - Database Schema
-- ============================================================

PRAGMA foreign_keys = ON;

-- ---------- Reference / lookup tables (admin-editable) ----------

CREATE TABLE brands (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE phone_models (
  id TEXT PRIMARY KEY,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  name TEXT NOT NULL,
  UNIQUE(brand_id, name)
);

CREATE TABLE part_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE quality_grades (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE colors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

-- ---------- Products ----------

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  brand_id TEXT NOT NULL REFERENCES brands(id),
  phone_model_id TEXT NOT NULL REFERENCES phone_models(id),
  part_type_id TEXT NOT NULL REFERENCES part_types(id),
  quality_grade_id TEXT REFERENCES quality_grades(id),      -- optional
  color_id TEXT REFERENCES colors(id),                       -- optional
  sale_price REAL NOT NULL,
  purchase_price REAL,                                       -- optional, for margin tracking later
  min_stock_level INTEGER NOT NULL DEFAULT 10,
  notes TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,                       -- soft-delete flag
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Warehouse locations ----------

CREATE TABLE warehouse_locations (
  id TEXT PRIMARY KEY,
  zone TEXT NOT NULL,
  shelf TEXT NOT NULL,
  level TEXT NOT NULL,
  box TEXT NOT NULL,
  label TEXT,                                                 -- human readable, e.g. "A-3-2-B"
  UNIQUE(zone, shelf, level, box)
);

-- A product can be split across multiple locations. Current stock
-- per location is stored here; total stock = SUM(quantity) per product.
CREATE TABLE product_stock (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  location_id TEXT NOT NULL REFERENCES warehouse_locations(id),
  quantity INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, location_id)
);

-- Append-only ledger of every stock change. This is the source of
-- truth used to reconstruct history and to safely support order edits.
CREATE TABLE stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id),
  location_id TEXT REFERENCES warehouse_locations(id),
  change_qty INTEGER NOT NULL,                                -- positive = added, negative = removed
  reason TEXT NOT NULL,                                        -- 'initial' | 'order_confirmed' | 'order_edited' | 'order_cancelled' | 'manual_adjustment'
  order_id TEXT,                                                -- nullable, references orders(id)
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Customers ----------

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (name IS NOT NULL OR phone IS NOT NULL)
);

-- ---------- Orders ----------

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  order_number INTEGER,                                        -- simple human-friendly incrementing number
  customer_id TEXT REFERENCES customers(id),
  status TEXT NOT NULL DEFAULT 'draft',                         -- 'draft' | 'confirmed' | 'edited' | 'cancelled'
  channel TEXT NOT NULL DEFAULT 'manual',                       -- 'manual' | 'whatsapp' | 'website' (future)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  unit_price_at_order REAL NOT NULL,                            -- snapshot of price at order time
  is_cancelled INTEGER NOT NULL DEFAULT 0,                       -- for line-item level cancellation
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Suppliers (used by future reorder workflow) ----------

CREATE TABLE suppliers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_info TEXT,
  country TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Placeholders for future phases (kept empty in MVP) ----------

CREATE TABLE purchase_orders (
  id TEXT PRIMARY KEY,
  supplier_id TEXT REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  amount REAL,
  method TEXT,                                                  -- 'cash' | 'bank_transfer' | ...
  paid_at TEXT
);

-- ---------- Indexes for search performance ----------

CREATE INDEX idx_products_brand ON products(brand_id);
CREATE INDEX idx_products_model ON products(phone_model_id);
CREATE INDEX idx_products_part_type ON products(part_type_id);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);
CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_name ON customers(name);
