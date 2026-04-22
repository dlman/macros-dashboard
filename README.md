# Macros Dashboard

Personal nutrition, weight, sleep, and training dashboard built as a static multi-file app for GitHub Pages.

## Structure

- `index.html`: dashboard shell and markup
- `styles.css`: all dashboard styling
- `js/data.js`: raw nutrition and sleep datasets
- `js/core.js`: shared state, helpers, and analytics logic
- `js/charts.js`: chart setup and chart update logic
- `js/interactions.js`: UI wiring, exports, settings, and initialization

## Local Use

Open `index.html` in a browser.

## GitHub Pages

This repo is set up to publish the dashboard from the root `index.html` file on the `main` branch.

## Private Google Sheets Sync

The repo now includes [scripts/sync_google_sheets.py](/Users/dickson/Desktop/macros-dashboard/scripts/sync_google_sheets.py) so we can pull private sheet data into [js/data.js](/Users/dickson/Desktop/macros-dashboard/js/data.js) without making the sheet public.

### Expected setup

- Share the sheet with a Google service account
- Provide either:
  - `GOOGLE_SERVICE_ACCOUNT_JSON`
  - or `GOOGLE_SERVICE_ACCOUNT_FILE`
- Provide `GOOGLE_SHEET_ID`

Optional tab names:

- `GOOGLE_SHEET_MACROS_TAB` default: `Macros`
- `GOOGLE_SHEET_MACROS_TABS` optional comma-separated list, for example `Jan Macros,Feb Macros,March Macros`
- `GOOGLE_SHEET_SLEEP_TAB` default: `Sleep`
- `GOOGLE_SHEET_STEPS_TAB` default: `Steps`

### Install dependencies

```bash
python3 -m pip install -r requirements-sync.txt
```

### Run locally

```bash
python3 scripts/sync_google_sheets.py
python3 update_bayes.py
```

If sleep or steps still come from another source, you can keep the current values already in [js/data.js](/Users/dickson/Desktop/macros-dashboard/js/data.js):

```bash
python3 scripts/sync_google_sheets.py --skip-sleep --skip-steps
python3 update_bayes.py
```

### Sheet header mapping

The script uses forgiving header aliases. The required macros columns are:

- `date`
- `protein`
- `carbs`
- `fat`
- `calories`

Optional macros columns:

- `weight`
- `lifting`
- `drinks`
- `notes`

Sleep and steps tabs are also alias-based, but should at least include `date` plus the expected metric columns for whichever tab you use.

If your workbook is split into monthly macro tabs like `Jan Macros`, `Feb Macros`, and `March Macros`, set `GOOGLE_SHEET_MACROS_TABS` instead of `GOOGLE_SHEET_MACROS_TAB`.

To add a new month, publish its Google Sheet tab and add its URL to `PUBLISHED_CSV_URLS` in `scripts/sync_google_sheets.py`. The dashboard derives everything from `ACTIVE_MONTHS` (the months present in `data`), so no other code changes are needed — stat cards, donut charts, toggle buttons, and all chart datasets update automatically.

## Apple Health Steps Sync

The repo includes [scripts/sync_steps.py](/Users/dickson/Desktop/macros-dashboard/scripts/sync_steps.py) plus the GitHub Actions workflow `.github/workflows/sync-steps.yml` so Apple Health steps can be pushed into [js/data.js](/Users/dickson/Desktop/macros-dashboard/js/data.js) without a manual export/import step every day.

### What the workflow accepts

You can trigger the workflow in either mode:

- Single day:
  - `date`
  - `steps`
- Backfill payload:
  - `payload_json`
  - JSON object or array of `{ "date": "YYYY-MM-DD", "steps": 12345 }`

If both are provided, the payload rows are merged first and the single-day row is merged after that.

### Local examples

```bash
python3 scripts/sync_steps.py --date 2026-04-21 --steps 8450
python3 scripts/sync_steps.py --payload-json '[{"date":"2026-04-20","steps":7544},{"date":"2026-04-21","steps":8450}]'
python3 update_bayes.py js/data.js
```

### Apple Shortcut → GitHub Actions

The workflow name is `sync-steps.yml`.

GitHub API endpoint:

```text
POST https://api.github.com/repos/<owner>/<repo>/actions/workflows/sync-steps.yml/dispatches
```

Headers:

- `Authorization: Bearer <GH_PAT>`
- `Accept: application/vnd.github+json`
- `Content-Type: application/json`

Single-day request body:

```json
{
  "ref": "main",
  "inputs": {
    "date": "2026-04-21",
    "steps": "8450"
  }
}
```

Backfill request body:

```json
{
  "ref": "main",
  "inputs": {
    "payload_json": "[{\"date\":\"2026-04-20\",\"steps\":7544},{\"date\":\"2026-04-21\",\"steps\":8450}]"
  }
}
```

The workflow then:

1. merges the steps into `js/data.js`
2. rebuilds Bayesian artifacts
3. validates the dashboard
4. commits and pushes if anything changed
