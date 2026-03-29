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

One current limitation: the dashboard code is still hard-coded around `Jan`, `Feb`, and `March` 2026 buckets. If the synced sheet starts feeding newer months, the sync script will fail loudly instead of silently writing data the dashboard cannot render correctly.
