# Secure File Cloud
**Secure File Segmentation, Encrypted Cloud Download and Static Site Hosting with CDN Integration**
Cloud Computing Mini Project · Third Year Engineering · Department of Artificial Intelligence and Data Science

---

## 1. What this project does (in simple words)

1. You pick a file in the browser.
2. The browser **cuts it into 5 MB segments** (`part00000.enc`, `part00001.enc`, ...).
3. The browser **encrypts every segment with AES-256-GCM** using a secret key that is created in the browser and never leaves it.
4. Only the **encrypted segments** are uploaded to a **private Amazon S3 bucket**.
5. To download, the browser fetches the segments, **decrypts and checks each one**, **joins them in order**, and gives you the original file back.
6. The website itself is stored in S3 and delivered through **Amazon CloudFront (CDN)** over HTTPS.

### Objectives (from the report)
- Divide a file into fixed-size blocks and merge them back without loss.
- Encrypt every segment before upload and decrypt after download, so the cloud only ever holds encrypted data.
- Host a website on cloud object storage (S3) with `index.html` and `error.html`.
- Integrate a CDN (CloudFront) to reduce latency and serve the site over HTTPS.
- Measure performance: segmentation, encryption, upload, download, decryption and rebuild times, and CDN cache status.

### Honest scope notes
- **S3 + CloudFront are the cloud implementation** (the report lists Azure and Google as alternatives; they are not implemented).
- The **Flask backend runs on your computer** (it is not hosted on AWS). The static website is what runs on S3 + CloudFront.
- Everything marked "tested" in `docs/TEST_RESULTS.md` was really run. **The tests against a real AWS account and a real CloudFront URL are for you to run** (checklist included); they were not run when this project was prepared.

## 2. Technologies

| Part | Technology |
|---|---|
| Frontend | HTML5, CSS3, JavaScript (ES modules), Bootstrap 5, Bootstrap Icons |
| Browser crypto | Web Crypto API (AES-256-GCM) |
| Backend | Python 3.10+, Flask |
| Cloud SDK | boto3 (presigned URLs, bucket checks) |
| Cloud | Amazon S3 (private buckets), Amazon CloudFront (OAC, HTTPS) |
| Tests | Python `unittest`, Node.js 18+ (end-to-end) |

## 3. System architecture

```
                    (key stays here)
 ┌──────────────┐  1. ask for signed URLs   ┌───────────────┐   uses AWS credentials
 │   Browser    │ ────────────────────────► │ Flask backend │ ──────────────► (boto3)
 │ split+encrypt│ ◄──────────────────────── │ (your PC)     │
 └──────┬───────┘   signed URLs, manifest   └───────────────┘
        │ 2. PUT / GET encrypted segments (presigned, short-lived)
        ▼
 ┌──────────────────────────┐
 │ S3 data bucket (private) │  uploads/<file-id>/part00000.enc ... + manifest.json
 └──────────────────────────┘

 Website:  visitor ──► CloudFront (edge cache, HTTPS) ──OAC──► S3 site bucket (private): index.html, error.html, js, css
```

**Segment format:** `nonce (12 bytes) || ciphertext || GCM tag (16 bytes)`. **AAD** (authenticated additional data) = the segment index as text (`"0"`, `"1"`, ...). Every segment adds 28 bytes. A 100 MB file = 20 segments = 560 bytes overhead.

**Why the key is safe:** it is generated in the browser, shown only to you, saved as a key file you keep, and typed/loaded again for download. The backend API has no field for it and never receives it.

## 4. Folder structure

```
secure-file-cloud/
├── backend/            Flask app: app.py, api.py, storage.py (S3 + local dev), activity.py, config.py
├── frontend/           Website (this is what you upload to the S3 site bucket)
│   ├── index.html dashboard.html upload.html download.html performance.html about.html error.html
│   ├── style.css  config.js
│   └── js/             crypto.js, transfer.js (segment/encrypt/upload/download/merge), api.js, ui.js, page scripts
├── aws/                Ready-to-edit JSON: CORS, bucket policies, IAM policies
├── scripts/            setup_buckets.py, deploy_site.py, verify_segments.py (Python decryptor)
├── tests/              test_backend.py, e2e.mjs, run_e2e.py
├── docs/               TEST_RESULTS.md and raw test output
├── requirements.txt  .env.example  .gitignore  README.md
```

## 5. Install the software (Windows 10/11)

1. Install **Python 3.10 or newer** from python.org (tick "Add Python to PATH").
2. Install **AWS CLI v2** from aws.amazon.com/cli.
3. (Only for running the end-to-end tests) install **Node.js 18 or newer** from nodejs.org.
4. Use **Chrome, Edge or Firefox**.

```powershell
cd secure-file-cloud
python -m venv .venv
.venv\Scripts\activate            # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env            # Linux/macOS: cp .env.example .env
```

## 6. AWS account setup

1. Create an AWS account (aws.amazon.com). Turn on MFA for the root user. **Do not use the root user for this project.**
2. In **IAM → Users → Create user** (e.g. `sfc-backend`). Attach a custom policy made from `aws/iam-backend-policy.json` (replace `YOUR_DATA_BUCKET`). This user can only list the data bucket and read/write/delete objects under `uploads/`.
3. Open the user → **Security credentials → Create access key → "Command Line Interface"**.
4. Run `aws configure` and paste the access key and secret there. They are saved in your user folder, **not in this project and never in frontend code**. Never share them with anyone (not even an AI assistant).
5. For the one-time bucket setup and site deployment you need more permissions than the backend user. Use a second IAM user (e.g. `sfc-admin`) with `AmazonS3FullAccess` and `CloudFrontFullAccess` while learning, in a separate CLI profile: `aws configure --profile sfc-admin`. Then run the setup scripts with `set AWS_PROFILE=sfc-admin` (PowerShell: `$env:AWS_PROFILE="sfc-admin"`). `aws/iam-deployer-policy.json` is a tighter alternative for deployment.
6. Set a **billing budget** (Billing → Budgets) so you get an email if spending goes above, for example, 1 USD.

## 7. S3 buckets and CloudFront

Bucket names are global; pick unique ones, e.g. `sfc-data-yourname-2026` and `sfc-site-yourname-2026`.

### 7.1 Environment variables
Edit `.env` (copied from `.env.example`): set `AWS_REGION`, `S3_DATA_BUCKET`, `S3_SITE_BUCKET`, `STORAGE_BACKEND=s3`. Leave `CLOUDFRONT_*` empty for now.

### 7.2 Create both private buckets (one command)
```powershell
$env:AWS_PROFILE="sfc-admin"
python scripts/setup_buckets.py
```
It creates the buckets with **Block Public Access ON**, default encryption, an HTTPS-only policy, and CORS on the data bucket (needed so the browser may PUT/GET segments). Manual alternative: S3 console → Create bucket → keep "Block all public access" ticked; then Permissions → CORS → paste `aws/data-bucket-cors.json`.

### 7.3 Create the CloudFront distribution (console)
1. CloudFront → **Create distribution**.
2. **Origin domain**: choose your **site bucket** (the `...s3.<region>.amazonaws.com` entry, *not* the "website endpoint").
3. **Origin access**: *Origin access control settings (recommended)* → Create new OAC (defaults, "Sign requests").
4. **Viewer protocol policy**: *Redirect HTTP to HTTPS*. **Cache policy**: *CachingOptimized*. **Default root object**: `index.html`.
5. Create. CloudFront shows a banner with a **bucket policy** - click *Copy policy* and paste it into the site bucket (S3 → bucket → Permissions → Bucket policy). `aws/site-bucket-policy-oac.json` is the same policy as a template.
6. Distribution → **Error pages → Create custom error response**, twice (HTTP error codes **403** and **404**): response page path `/error.html`, HTTP response code `404`. (A private bucket returns 403 for missing files, so both are needed.)
7. Copy the **Distribution domain name** (`dxxxxxxxx.cloudfront.net`) and the **Distribution ID**. Put them in `.env` as `CLOUDFRONT_DOMAIN` and `CLOUDFRONT_DISTRIBUTION_ID`, and add `https://dxxxxxxxx.cloudfront.net` to `ALLOWED_ORIGINS` (comma separated).
8. Re-run `python scripts/setup_buckets.py` so the data bucket CORS also allows your CloudFront address.

### 7.4 Deploy the website to S3 (+ clear the CDN cache)
```powershell
python scripts/deploy_site.py --api-base http://localhost:5000 --invalidate
```
This uploads everything in `frontend/` with correct content types and cache headers, points the deployed `config.js` to your backend, and invalidates the CloudFront cache so the new version shows immediately. Use the same command after every website change. Manual equivalent:
```
aws s3 sync frontend s3://YOUR_SITE_BUCKET --delete
aws cloudfront create-invalidation --distribution-id YOUR_DISTRIBUTION_ID --paths "/*"
```
Open `https://dxxxxxxxx.cloudfront.net`. The first load of a CloudFront distribution can take a few minutes after creation (status *Deploying*).

> **How CloudFront speeds things up:** your browser contacts the nearest *edge location*. If it already has `index.html` cached it answers instantly (cache **Hit**); otherwise it fetches the file once from S3 (cache **Miss**) and keeps it for the next visitors. The Performance page reads the real `X-Cache`, `Age` and edge location headers to show this.

> **About "S3 static website hosting":** the report mentions S3 website hosting with an index and error document. This project uses the modern, safer way: a *private* bucket, CloudFront as the only door (OAC), `index.html` as default root object and `error.html` as the error page. The old "website endpoint" only supports HTTP and requires a *public* bucket, so it is not used.

## 8. Run the application

```powershell
.venv\Scripts\activate
python -m backend.app
```
Open **http://localhost:5000** (the Flask server also serves the website for local use). The top-right badge should say **AWS S3 connected**. If you open the site from CloudFront instead, keep the backend running on the same computer.

*No AWS yet?* Set `STORAGE_BACKEND=local` to practise offline. Files then go to `backend/data/local_storage` and the badge says "Local dev storage". This mode is only for development and tests, **not cloud storage**.

## 9. How to test upload and download (demo script)

1. **Dashboard** - check the badge shows S3 connected.
2. **Secure Upload** - choose a small file, then a file larger than 10 MB (so you see several segments). Click *Encrypt & Upload*. Watch the segment table fill. A key file `.sfskey` downloads automatically - **keep it**.
3. In the **S3 console** open the data bucket → `uploads/<id>/`: you see `part00000.enc`, `part00001.enc`, ... and `manifest.json`. Download one `.enc` object and open it: it is unreadable. Your original file name appears only in `manifest.json`.
4. **Secure Download** - select the file, load the key file, click *Fetch, Decrypt & Restore*. Compare the restored file with the original (e.g. `certutil -hashfile file SHA256` on Windows - the hashes must match).
5. **Wrong key test** - try a different key: you get "Authentication failed" and no file.
6. **Corrupted segment test** - in S3 console upload any other `.enc` over one segment (or use the automated test) and try again: it is detected.
7. **Performance** page - see your measured times. Open it via the CloudFront URL and run the CDN probe: the first request is normally a *Miss*, later ones *Hit*.
8. **Dashboard** - counts and activity now reflect what you did.

Automated tests (no AWS needed):
```
python -m unittest discover -s tests -v     # 11 backend tests
python tests/run_e2e.py                     # 26 end-to-end tests (needs Node.js 18+)
```
Independent check with plain Python (same algorithm as the report's source code): download the `.enc` files into one folder, then
`python scripts/verify_segments.py <folder> <file.sfskey> restored.bin`

## 10. Security summary

Implemented: AES-256-GCM per segment · fresh random 12-byte nonce each segment · 16-byte tag verified on decrypt · segment index as AAD · key generated in the browser and never sent or stored · private buckets with Block Public Access · presigned URLs valid for `PRESIGN_EXPIRY_SECONDS` (default 600 s) · AWS keys only on the backend · server checks every uploaded segment's size · incorrect key / modified / truncated / swapped / missing segments rejected with no output file · key file records segment count so removing a segment from the cloud manifest is also detected.

Not implemented (be honest in your viva): no user login or per-user access control; file names/sizes/times are visible in the cloud manifest; presigned PUT URLs cannot enforce a maximum size (the backend checks sizes afterwards and deletes bad uploads); the restored file is built in browser memory; key loss is permanent.

## 11. AWS charges and free-tier limits

AWS changed its free tier in July 2025: new accounts choose a *Free plan* or *Paid plan* with starter credits, and the Free plan ends after about 6 months or when credits run out. Sources disagree on whether CloudFront's 1 TB / 10 million requests per month allowance is permanent or only for the first 12 months, and CloudFront also has newer flat-rate plans. **Check the official pages before you rely on any number:** aws.amazon.com/free and aws.amazon.com/s3/pricing and aws.amazon.com/cloudfront/pricing. For this project, usage is tiny (a few MB of storage and a few requests), so cost is normally very low, but you can still be charged. To stay safe: set a budget alert, delete test files with the *Delete* button, empty and delete both buckets and the CloudFront distribution after your demo (disable the distribution first, then delete), and delete the IAM access keys you created.

## 12. Troubleshooting

| Problem | Cause and fix |
|---|---|
| Badge says **Backend offline** | Start `python -m backend.app`. If the site is on CloudFront, check `config.js` `API_BASE` (redeploy with `--api-base`). |
| Startup error "S3_DATA_BUCKET is not set" | Fill `.env`. |
| Badge says **Cloud unreachable** | Run `aws sts get-caller-identity`. Wrong region/bucket name or missing credentials/permissions (check IAM policy). `NoCredentialsError` → run `aws configure`. |
| Upload fails with "Network error ... CORS" | Data bucket CORS must list your website origin (`python scripts/setup_buckets.py` after adding it to `ALLOWED_ORIGINS`). Origins must match exactly (`http://localhost:5000` ≠ `http://127.0.0.1:5000`). |
| HTTP 403 `SignatureDoesNotMatch` on PUT | Wrong `AWS_REGION` for the bucket, or PC clock is wrong. |
| HTTP 403 `Request has expired` | Signed URL lifetime ended (huge file on slow link). Raise `PRESIGN_EXPIRY_SECONDS`. |
| CloudFront shows `AccessDenied` XML | Bucket policy for OAC missing/wrong distribution ID, or origin was the website endpoint. |
| Website change not visible | Run `deploy_site.py --invalidate`; hard-refresh (Ctrl+F5). |
| CloudFront page cannot reach backend | Use Chrome/Edge/Firefox (they allow `http://localhost` from an HTTPS page). Safari may block it. |
| `crypto.subtle` is undefined | The page must be HTTPS or localhost. Do not open the files with `file://`. |
| "Authentication failed for segment N" | Wrong key file, or that segment was changed. |
| "Port 5000 in use" | Set `PORT=5050` in `.env` and add that origin to `ALLOWED_ORIGINS`. |
| Large file runs out of memory | Lower `MAX_FILE_MB` or use a computer with more RAM. |
