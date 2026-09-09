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

`d-form4-fraction.txt` retains the transaction rows, including `.3258` fractional shares, from accession 0000029534-26-000070:
https://www.sec.gov/Archives/edgar/data/29534/000002953426000070/0000029534-26-000070.txt

`xcel-form3-exhibit.txt` retains ownership XML and the attached EX-24 HTML doctype from accession 0001389812-26-000004:
https://www.sec.gov/Archives/edgar/data/820027/000138981226000004/0001389812-26-000004.txt

These regression fixtures omit addresses, signatures, and exhibit body text.

`ptc-0001654954-26-004735.xml` and `ptc-0001654954-26-004635.xml` preserve the ownership documents from PTC / Alice Christenson filings retrieved September 8, 2026. Transaction dates include valid XML Schema timezone suffixes (`2026-05-12-05:00` and `2026-05-07-05:00`):
- https://www.sec.gov/Archives/edgar/data/857005/0001654954-26-004735.txt
- https://www.sec.gov/Archives/edgar/data/857005/0001654954-26-004635.txt

- `intel-companyfacts.json`: trimmed from the archived Intel Company Facts
  response observed 2026-09-07 (CIK 0000050863), retaining 2025 annual and 2026
  second-quarter earnings, share and common-equity reconciliation inputs.
  Source: https://data.sec.gov/api/xbrl/companyfacts/CIK0000050863.json
- `class-cover-10q.txt`: minimal synthetic filing structure using the Mastercard
  Class A/B share counts and cover labels inspected during this investigation;
  verifies attribution when the listing directory omits the class name.
- `ford-class-cover-10q.txt`: minimal synthetic structure preserving Ford's
  inspected listed-common and unlisted-Class-B share counts and cover title;
  verifies that an undesignated common class is not combined with Class B.
