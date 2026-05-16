# MDC UI/UX Pattern (Enterprise Inventory)

## Purpose
Define the approved inventory UI pattern for MDC so all screens keep the same enterprise look, behavior, and visual semantics.

## Brand System
- Product wordmark: `MDC` with compact mark icon on dark header.
- Header palette:
  - background gradient: `#0a3b45 -> #08333b`
  - default icon/text: `#9fb4ba`
  - active module accent: `#d9f32b`
- Content palette:
  - page background: `#efefef`
  - grid line: `#d0d0d0`
  - link/action blue: `#3c73a7`
  - negative values: `#c14f2e`

## Iconography (Real Icons, No Generic Glyphs)
Icon source: `lucide-react`.

Global/header icons:
- Brand mark: `Boxes`
- Main modules:
  - Inventory: `Boxes`
  - Stock-in: `PackagePlus`
  - Transfers: `ShieldCheck`
  - Corrections: `ClipboardCheck`
  - Exports: `FileDown`
  - Analytics: `BarChart3`
  - Settings: `Settings`
- Utility:
  - Notifications: `Bell`
  - Help: `CircleHelp`

Inventory controls:
- Date selector: `CalendarDays`
- Warehouse selector: `MapPin`
- Dropdown indicator: `ChevronDown`
- Stocktake action: `ClipboardCheck`
- Export icon button: `Download`
- Print icon button: `Printer`
- Grid info cell: `Info`
- Row select cell: `Square`
- Row open action: `ExternalLink`

Rules:
- Never use Unicode placeholders (e.g. `?`, `●`, `☑`, `⇩`, `⎙`) for production actions.
- Icon buttons must include `aria-label`.
- Default icon size: `14-18px` depending context.

## Layout Pattern
1. Global nav (dark, persistent): brand + primary modules + utility/account.
2. Sub-nav (light): section tabs (`Inventory`, `Batches`, `Serial numbers`, `Stock transfers`, `Stocktakes`).
3. Selector row:
- segment tabs (`All`, `Products`, `Materials`)
- right aligned inventory snapshot controls (`As of: Today`, `Site: Main warehouse`)
4. Accent divider: single blue rule below selector row.
5. Action row:
- left: item count + `Stocktake`
- right: export/print icon actions
6. Dense data grid:
- sticky semantic columns
- filter row directly under headers
- totals row first in body

## Approved Inventory Fields
Table headers must stay aligned with MDC data model:
- `Part name`
- `Part no.`
- `Category`
- `In stock`
- `Committed`
- `Available`
- `Last stock-in date`
- `Last stock-out date`

Derived field logic:
- `In stock` = count of serials where status is `in_stock`
- `Committed` = count of serials where status is `transferred`
- `Available` = `max(in_stock - committed, 0)`
- `Last stock-in date` = max `stock_in_at`
- `Last stock-out date` = max `coalesce(transfers.packed_at, transfers.created_at)` joined through `transfer_items` and excluding `draft/cancelled`

## Interaction and State Standards
- Loading: skeleton rows in table body.
- Empty: explicit message in-table, no blank panels.
- Error: inline banner above table.
- Filters: immediate local response for the loaded dataset.
- Row action: `Open` as explicit final-column action.
- Table sort: click column headers to toggle asc/desc.
- Selection: checkbox per row + header select-all for visible rows.
- Bulk actions: appear only when rows are selected (`Transfer selected`, `Export selected`, `Stocktake selected`, `Clear selection`).
- Sticky table headers: label row + filter row remain visible while scrolling.

## Accessibility
- Every icon-only button must have `aria-label`.
- Filter inputs must have descriptive `aria-label`.
- Contrast must remain readable against dark header and light table backgrounds.
- Keyboard focus should remain visible on all interactive controls.

## Responsive Rules
- Keep global/sub nav horizontally scrollable where needed.
- Preserve table (horizontal scroll) over collapsing columns on tablet.
- Keep action row and selector controls tappable (min touch target ~36px height).

## Non-Negotiables
- Do not introduce floating center FAB for this screen.
- Do not replace Lucide icons with emoji/unicode symbols.
- Do not rename inventory headers unless data model changes.
