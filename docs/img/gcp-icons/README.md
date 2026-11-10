# Google Cloud icons

Product icons for GCP resource nodes on lab maps and hero images. Each file is named after the attack map `subType` it renders, and is wired in through `cloudIconSprites.iconPaths` and `SUBTYPE_DISPLAY` in `docs/js/map-game.js`.

Source: Google Cloud's legacy product icon set from https://cloud.google.com/icons, downloaded 2026-11-10. The download had no license file; see that page for Google's usage terms. The legacy set is used because the current "core products" pack has no IAM, Secret Manager or Cloud Functions icons. All GCP icons come from the legacy set, so they share one style.

| File | subType | Legacy icon |
|------|---------|-------------|
| `service-account_48.png` | `service-account` | `identity_and_access_management` |
| `secret-manager-secret_48.png` | `secret-manager-secret` | `secret_manager` |
| `cloud-function_48.png` | `cloud-function` | `cloud_functions` |
| `cloud-run-service_48.png` | `cloud-run-service` | `cloud_run` |
| `gcs-bucket_48.png` | `gcs-bucket` | `cloud_storage` |

Only the icons in use are committed (not the whole pack). To add one:

1. Resize the 512px legacy PNG to 48px, matching the AWS sprites: `sips -z 48 48 <legacy>/<name>/<name>.png --out docs/img/gcp-icons/<subType>_48.png`
2. Add the subType to both `cloudIconSprites.iconPaths` and `SUBTYPE_DISPLAY` in `docs/js/map-game.js`.
3. Bump the `map-game.js` `?v=` in `docs/labs/index.html` and `docs/labs/getting-started/index.html`, then regenerate the lab stubs. If any lab hero using that subType is already committed, bump `HERO_RENDER_VERSION` in `scripts/generate-lab-hero-images.js` (icon files aren't part of the hero fingerprint).
