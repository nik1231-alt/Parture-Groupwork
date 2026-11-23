# Revert plan for real title changes (checklist B1.9)

Applies to every step where the write switch `EBAY_SCHREIBEN=an` is set on PROD: mini test with the shop management (B1.7),
real test (B1.8), demo (4 Dec). **Fill it in before switching on, and put a printout next to the computer.**

| Listing (no. / eBay id) | old title (verbatim, copied from the app) | new title | changed on | reverted on | who clicks |
|---|---|---|---|---|---|
| 231-3 / … | … | … | … | … | Niko |
| 2103 / … | … | … | … | … | Niko |
| 104 / … | … | … | … | … | Niko |
| 2096 / … | … | … | … | … | Niko |

## Reverting step by step

1. Close the test in the app with **revert** → for every changed listing a reverting change to the old title is created.
2. An admin approves the reverting changes under **Approvals** (the switch must still be on for this).
3. Open every listing on eBay and compare the title with the column "old title". Take a screenshot.
4. Switch off (`EBAY_SCHREIBEN=` empty), restart the PROD watcher, `/api/betrieb` shows `schreibenAn: false`.
5. Send a short message to the shop management: which listings, titles reverted yes/no.

## If the app cannot revert

eBay refuses, the app is unreachable, or the title was changed by hand in the meantime: the shop management changes the title in the eBay
seller portal by hand back to the old title from this table. Afterwards add an entry to the table.

## After the demo

Revert all changed titles, or the shop management explicitly decides to keep individual ones (note that here, with the date).

**During a test do not touch the Shopify titles of these products** (B1.5): the Parture hub writes every
title change in the Shopify shop to eBay within 10 minutes and would overwrite the test title that way.
