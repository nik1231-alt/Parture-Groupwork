# Screenshots of the demo steps (issue #19)

Taken on 20.11.2026 with headless Chrome on a local copy of `main` (team catalogue, two demo users `lena` = admin and
`tom` = builder, real Gemini suggestions, no eBay keys, so every approval is a dry run).

| # | File | What it shows |
|---|---|---|
| 1 | [01-products.png](screens/01-products.png) | Products: all 1,001 products with price, sales, impressions and diagnosis |
| 2 | [02-product-details.png](screens/02-product-details.png) | one product opened: numbers, its status in the funnel with the reason, variants (colours with SKU and price), channels, history |
| 3 | [03-funnel-overview.png](screens/03-funnel-overview.png) | Funnel: KPIs, every status with its count (not eligible with reasons, eligible, control group, phases), effect against the control group |
| 4 | [04-funnel-work-queue.png](screens/04-funnel-work-queue.png) | work queue: AI title next to the old one with the AI's reason, approve / done by hand / skip; a running waiting time |
| 5 | [05-funnel-not-eligible.png](screens/05-funnel-not-eligible.png) | click on "Not eligible": the table filters to those products, each with the reason |
| 6 | [06-funnel-dark.png](screens/06-funnel-dark.png) | the same page in dark mode |
| 7 | [07-funnel-phone.png](screens/07-funnel-phone.png) | phone width (400 px): no sideways scrolling |
| 8 | [08-log.png](screens/08-log.png) | append-only log with who did what (lot, AI suggestions, dry-run approval) |
| 9 | [09-sign-in.png](screens/09-sign-in.png) | sign-in page |
| 10 | [10-settings-builder.png](screens/10-settings-builder.png) | a builder sees the rules but cannot change them |
| 11 | [11-funnel-builder.png](screens/11-funnel-builder.png) | a builder sees the work queue without approve buttons |
