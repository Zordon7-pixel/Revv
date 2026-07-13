# REVV Media Storage

## Purpose

REVV user-generated media must survive application deploys, container replacement, and a single storage-copy failure. Persistent media includes RO photos, customer portal photos, claim evidence, claim assessments, and shop logos. Temporary estimate/OCR work files remain ephemeral by design.

## Storage Contract

- Primary durable object copy: private Railway S3-compatible bucket.
- Local serving/cache copy: Railway volume mounted at `/app/backend/uploads`.
- Existing application URLs remain `/uploads/<category>/<file>`.
- A new upload is not written to application metadata until the volume file has been uploaded to the bucket and verified by byte length plus SHA-256 metadata.
- With `MEDIA_REQUIRE_OBJECT_STORAGE=true`, a bucket failure returns `503` and no DB record is created.
- Reads use the volume first and privately proxy the bucket only when the volume file is absent.
- User deletion removes both copies before deleting the metadata row. A storage failure leaves the metadata row in place so the operation can be retried.

## Managed Paths

- `/uploads/photos/`
- `/uploads/portal-photos/`
- `/uploads/claim-evidence/`
- `/uploads/assessments/`
- `/uploads/shop-logos/`

## Runtime Variables

Set these on the REVV backend service. Do not expose them to the frontend.

- `MEDIA_BUCKET`
- `MEDIA_ENDPOINT`
- `MEDIA_ACCESS_KEY_ID`
- `MEDIA_SECRET_ACCESS_KEY`
- `MEDIA_REGION`
- `MEDIA_URL_STYLE`
- `MEDIA_REQUIRE_OBJECT_STORAGE=true`

The service also accepts Railway/AWS-compatible aliases (`BUCKET`, `ENDPOINT`, `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY`, and standard `AWS_*` names).

## Integrity And Recovery

`backend/src/jobs/mediaIntegrity.js` runs at startup and every 24 hours.

1. A volume-only file is mirrored to the bucket.
2. A bucket-only referenced file is restored to the volume.
3. If both copies exist and the volume checksum differs from the bucket's verified SHA-256 metadata, the bucket copy restores the volume copy.
4. A reference missing from both stores is counted and reported, never silently deleted or rewritten.
5. Logs report `references`, `healthy`, `mirrored`, `restored`, `local_only`, and `missing` counts without printing customer content or storage credentials.

Railway volume backups are an additional disaster-recovery layer. They do not replace the private object copy.

## Historical Incident Boundary

The July 2026 audit found 48 historical `ro_photos` rows and one claim-evidence row whose files were already absent from the old ephemeral filesystem. The object-storage rollout prevents recurrence but cannot reconstruct bytes that no longer exist. Those records must remain intact so a shop can identify and re-upload the originals if found.
