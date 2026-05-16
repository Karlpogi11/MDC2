# UI Spec (Katana-like Inventory View)

## Goal
Provide a dense operational inventory screen that feels like a real warehouse control panel.

## Layout
- Top dark navigation bar with modules (`Inventory`, `Batches`, `Serial Numbers`, `Stock Transfers`, `Stocktakes`)
- Secondary filter bar:
  - scope tabs (`All`, `Products`, `Materials`)
  - date selector
  - warehouse/site selector
- Data grid with fixed header and horizontal scroll

## Table Columns
- Checkbox
- Part name
- Part number
- Category
- In stock
- Committed
- Available
- Last stock-in date
- Last stock-out date

## Interactions
- Global quick search (part no / serial)
- Column-level filters
- Bulk row select for transfer/export actions
- Inline status badges for risk (`low stock`, `negative`, `committed`)

## Required Actions
- `Stock-in`
- `Transfer`
- `Correct Serial`
- `Export`

## Performance Rules
- server-side pagination and filtering
- debounce search 250-350ms
- virtualized rows when >500 records

## Mobile Behavior
- keep summary cards on top
- table switches to card list with key quantities
- sticky action bar for stock-in/export
