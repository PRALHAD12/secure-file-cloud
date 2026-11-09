# Test results

## A. Tests that were actually executed (local-development storage, no AWS)

Run date: 2 Nov 2026 · Python 3.12 · Node 22 · Flask test client + live Flask server.
The **same browser modules** used by the website (`crypto.js`, `transfer.js`, `api.js`) were run in Node against a live backend.
`STORAGE_BACKEND=local` stores objects in a folder and mimics S3 presigned URLs. This proves the application logic, **not** AWS connectivity.

| # | Test | Result |
|---|---|---|
| 1 | Backend unit tests (validation, naming, presign, verification, cleanup, CORS, stats, delete) | **11 / 11 passed** (`docs/unit-output.txt`) |
| 2 | Upload + segment + encrypt: 12.3 MB (3 segments), 10 MB (2), 1.5 KB (1), 1 byte (1) | Passed; names `part00000.enc`..., sizes = plain + 28 bytes |
| 3 | Only ciphertext stored: known plaintext marker not found in any stored object | Passed (9 objects scanned) |
| 4 | Key never stored: key (base64/hex) not found in storage files or activity DB | Passed |
| 5 | Unique random nonce per segment | Passed (6 of 6 unique) |
| 6 | Download + decrypt + merge, SHA-256 compared with original (4 files) | Passed, hashes identical |
| 7 | Key accepted as base64, base64url, hex, key file | Passed |
| 8 | Wrong key | Rejected: "Authentication failed for segment 0", no file |
| 9 | Invalid key formats / key file of another file | Rejected with clear messages |
| 10 | Corrupted segment (1 bit), modified nonce, truncated segment | All detected, no file |
| 11 | Swapped segments (index AAD) | Detected |
| 12 | Missing segment in storage; segment removed from manifest | Detected (HTTP 404 error; key-file segment-count mismatch) |
| 13 | Python reference decryptor (`scripts/verify_segments.py`) restores browser-encrypted segments | Passed |
| 14 | Dashboard/performance numbers come from real data | Passed |
| 15 | Upload completion rejected when segments were never sent; delete removes objects | Passed |

Total end-to-end: **26 / 26 passed** (`docs/e2e-output.txt`).

## B. Not executed here - you must run these with your AWS account

The preparation environment had no internet access, no AWS account and no web browser, so the following were **not** tested. The code for them is complete; fill in the last column during your demo and add screenshots to your report (Chapter 5).

| # | Test | How | Your result |
|---|---|---|---|
| B1 | Backend connects to S3 | Dashboard badge "AWS S3 connected" | |
| B2 | Upload small file to S3 | Upload page; check `uploads/<id>/` in S3 console | |
| B3 | Upload file > 10 MB (several segments) | Same | |
| B4 | Only encrypted objects in S3 | Download a `.enc` object and inspect it | |
| B5 | Restore from S3 and compare hash | Download page; `certutil -hashfile` on both files | |
| B6 | Wrong key | Download page with another key | |
| B7 | Corrupted segment in S3 | Overwrite one `.enc` object, download | |
| B8 | Bucket is private | Open an object URL without signature: must be AccessDenied | |
| B9 | Website loads via CloudFront HTTPS URL | Open `https://dxxxx.cloudfront.net` | |
| B10 | Error page | Open `https://dxxxx.cloudfront.net/nothing` → custom `error.html` | |
| B11 | Direct S3 access to site bucket blocked | Open the S3 object URL: AccessDenied | |
| B12 | CDN cache status | Performance page → CDN probe via CloudFront URL | |
| B13 | Cache invalidation | Edit a page, run `deploy_site.py --invalidate`, reload | |
| B14 | Upload from the CloudFront-hosted page (CORS) | Upload while on the CloudFront URL | |

## C. Not verified in a browser
The page layouts and the on-screen behaviour of the HTML/JS pages (drag-and-drop, progress bars, toasts, mobile sidebar) could not be opened in a real browser here. Their scripts were syntax-checked and their element IDs cross-checked against the HTML, and the underlying transfer logic is covered by the tests above. Please click through every page once and report anything that looks wrong.
