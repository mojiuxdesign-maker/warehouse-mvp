# Warehouse MVP — Backend (Step 1)

This is the first working version: database + API backend, with 500 realistic
mock smartphone-parts products, ready to be tested and built on.

## How to run it

1. Install Node.js (v18 or newer) from https://nodejs.org if you don't have it.
2. Open a terminal in this folder.
3. Install dependencies (only needed once):
   ```
   npm install
   ```
4. Create the database with sample data (only needed once, or anytime you want to reset):
   ```
   node db/seed.js
   ```
5. Start the server:
   ```
   node src/server.js
   ```
6. Open your browser to: http://localhost:3000
   (Right now this just shows a placeholder page — the real interface comes in the next step.
   The backend API is already live and testable, e.g. http://localhost:3000/api/products)

## What's included so far

- SQLite database (db/warehouse.db) — no separate database server needed
- 500 mock products across Apple / Samsung / Google, with brand, model, part type,
  quality grade, color, price, stock, and warehouse location
- Full order lifecycle: draft -> confirm -> edit -> cancel, with correct stock handling
- Customer order history, picking lists, low-stock dashboard, sales dashboard

## What's next

- The actual visual interface (Admin panel + Order/Dashboard panel)
