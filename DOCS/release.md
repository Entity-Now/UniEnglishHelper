# Release & store publishing

This document describes how to cut a version, publish a GitHub Release, and
optionally push the same package to **Chrome Web Store** and **Microsoft Edge
Add-ons**.

## 1. GitHub Release (always available)

### Trigger

Push a semver tag:

```bash
# 1) Bump version in package.json if you want it committed on main
#    (workflow also rewrites package.json for the build so the zip is correct)

git checkout main
git pull

# 2) Tag & push
git tag v1.0.0
git push origin v1.0.0
```

Pattern: `vMAJOR.MINOR.PATCH` (optional pre-release suffix: `v1.0.0-beta.1`).

### What the workflow does

File: [`.github/workflows/release.yml`](../.github/workflows/release.yml)

1. Install deps with pnpm  
2. Align `package.json` `version` with the tag (e.g. `v1.0.0` → `1.0.0`)  
3. `pnpm test` + `pnpm build`  
4. Zip **contents of `dist/`** (manifest at zip root) as  
   `uni-english-helper-1.0.0.zip`  
5. Create a **GitHub Release** with that zip attached  

Users can download the zip from the Release page and **Load unpacked** after unzipping.

---

## 2. Chrome Web Store — yes, via API (optional)

Google supports automated upload through the
[Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api).

### Prerequisites (one-time, manual)

1. Create a [Chrome Web Store Developer account](https://chrome.google.com/webstore/devconsole)
   (one-time registration fee).  
2. Create the listing and upload the **first** package in the dashboard
   (API updates an existing item; it does not create the store listing).  
3. Note your **Extension ID** (32-char id on the item page).  
4. Set up OAuth for the Web Store API:
   - Google Cloud project → enable **Chrome Web Store API**  
   - OAuth client (Desktop) → obtain `client_id` / `client_secret`  
   - Complete the refresh-token dance (Google’s docs or tools like
     [`chrome-webstore-upload-keys`](https://github.com/fregante/chrome-webstore-upload-keys))  
5. Add repository **secrets** and **variables** (below).

### Repository configuration

| Type | Name | Description |
|------|------|-------------|
| **Variable** | `ENABLE_CHROME_PUBLISH` | Set to `true` to run the Chrome job |
| **Variable** | `CHROME_PUBLISH_ACTION` | Optional: `upload` (default) or `publish` |
| **Secret** | `CHROME_EXTENSION_ID` | Store item id |
| **Secret** | `CHROME_CLIENT_ID` | OAuth client id |
| **Secret** | `CHROME_CLIENT_SECRET` | OAuth client secret |
| **Secret** | `CHROME_REFRESH_TOKEN` | Long-lived refresh token |

When `ENABLE_CHROME_PUBLISH` is not `true`, the Chrome job is **skipped** (no failure).

### Limits / caveats

- First publish and store assets (icons, screenshots, privacy policy) are **manual**.  
- Reviews are not instant; `publish` only submits for review.  
- API quotas and token expiry: re-generate refresh token if uploads start failing.  
- GPL-3.0 listing must still comply with [CWS policies](https://developer.chrome.com/docs/webstore/program-policies/).

---

## 3. Microsoft Edge Add-ons — yes, via API (optional)

Microsoft Partner Center exposes an
[Edge publishing API](https://learn.microsoft.com/en-us/microsoft-edge/extensions-chromium/publish/api/using-addons-api).

### Prerequisites (one-time, manual)

1. [Microsoft Partner Center](https://partner.microsoft.com/dashboard) account  
2. Create the Edge Add-on product and complete the **first** submission UI  
3. Create API credentials (Client ID / Secret) for publishing  
4. Copy **Product ID** from the product page  

### Repository configuration

| Type | Name | Description |
|------|------|-------------|
| **Variable** | `ENABLE_EDGE_PUBLISH` | Set to `true` to run the Edge job |
| **Secret** | `EDGE_PRODUCT_ID` | Partner Center product id |
| **Secret** | `EDGE_CLIENT_ID` | Edge publish API client id |
| **Secret** | `EDGE_API_KEY` | Edge publish API key |

When `ENABLE_EDGE_PUBLISH` is not `true`, the Edge job is **skipped**.

### Limits / caveats

- Same as Chrome: first listing is manual; CI only uploads/updates packages.  
- Certification can take hours–days.  
- Edge accepts Chromium MV3 packages (this project’s `dist` zip).  

---

## Recommended release checklist

- [ ] `package.json` version matches intended tag (optional if you rely on workflow rewrite)  
- [ ] `pnpm build && pnpm test` locally  
- [ ] README / changelog notes for the version  
- [ ] `git tag vX.Y.Z && git push origin vX.Y.Z`  
- [ ] Confirm GitHub Release has the zip  
- [ ] If stores enabled: open CWS / Partner Center and confirm package status  

## Manual packaging (local)

```bash
pnpm build
cd dist && zip -r ../uni-english-helper-local.zip . && cd ..
```

Load the unzipped `dist` folder via **Load unpacked**, or use the zip for store upload UIs.
