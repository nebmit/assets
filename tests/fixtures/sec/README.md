# SEC fixtures

`msft-form4.txt` is trimmed from SEC accession 0000789019-26-000141 (Microsoft / Takeshi Numoto, filed August 5, 2026):
https://www.sec.gov/Archives/edgar/data/789019/000078901926000141/0000789019-26-000141.txt

Addresses and signatures are omitted; the transaction, ownership roles, footnotes and acceptance timestamp are preserved. Test mutations of this fixture are synthetic edge cases, not other real filings.

`master-20250905.idx` preserves the header and selected rows from the September 5, 2025 daily master index, including its compact dates:
https://www.sec.gov/Archives/edgar/daily-index/2025/QTR3/master.20250905.idx

`msft-companyfacts.json` contains an older EPS fact with null `fy`/`fp` and a recent annual EPS fact, preserved from the Microsoft Company Facts response fetched during the September 6, 2026 ingestion:
https://data.sec.gov/api/xbrl/companyfacts/CIK0000789019.json

`ivv-holdings.csv` and `ijh-holdings.csv` retain the real fund metadata, CSV headers, three equity rows and selected non-equity/unlisted rows from iShares holdings dated September 3, 2026, downloaded September 6, 2026:
- https://www.ishares.com/us/products/239726/ishares-core-s-p-500-etf/latest-holdings.csv
- https://www.ishares.com/us/products/239763/ishares-core-s-p-mid-cap-etf/latest-holdings.csv

The full responses parsed to 503 and 400 listed equity holdings respectively. These fixtures test provider formats and exclusions, not full index completeness.
