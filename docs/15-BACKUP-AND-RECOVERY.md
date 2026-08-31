# Backup and recovery

GitHub protects source history; it does **not** contain the local PostgreSQL records, uploaded
documents or `.env` secrets. A recoverable MaturityFlow installation therefore has two layers:

1. the pushed Git repository; and
2. a recovery archive containing a Git bundle, database dump, documents and environment files.

## Create a backup

Close any running build and run PowerShell from the repository:

```powershell
$password = Read-Host 'Backup encryption password' -AsSecureString
.\scripts\backup.ps1 -EncryptionPassword $password
```

The default destination is the local `Documents\MaturityFlow Backups` folder. The script never
selects or connects a cloud provider. The archive is tested immediately after creation and the
command prints its SHA-256 hash. Store the encryption password in a password manager; it is
intentionally not written beside the archive.

For an unattended local copy, omit `-EncryptionPassword`. That archive is not encrypted and should
not be copied to removable media or shared. Customer and employee data are inside it.

Run a backup before migrations/imports, after a meaningful operating day, and before changing
laptops. Keep at least three generations. Never commit an archive, `.env`, `storage/` or a database
dump to GitHub.

## Verify what is protected

Each archive contains:

- `repository.bundle` — every local Git branch and tag;
- `source-at-head.zip` — readable source at the recorded commit;
- `database.dump` — PostgreSQL custom-format dump;
- `storage/` — uploaded maturity/KYC documents;
- `.env` / `.env.local` — local connection and session configuration;
- `restore-manifest.json` — commit, inventory, sizes and SHA-256 hashes.

Copying the archive anywhere else—including any cloud or network service—requires the owner's
explicit choice and permission. A local archive alone is not an off-device backup.

## Restore on another Windows PC

Install Git, Node 20+, PostgreSQL 16+ and 7-Zip. Copy the latest archive from the storage location
you explicitly chose and:

```powershell
& 'C:\Program Files\7-Zip\7z.exe' x .\MaturityFlow-YYYYMMDD-HHMMSS.7z -o.\recovery
git clone .\recovery\repository.bundle MaturityFlow
Set-Location .\MaturityFlow
npm ci
```

Copy `.env`, `.env.local` and `storage` from `recovery` into the new repository. Create the target
database and restore it (replace the names/user for the new machine):

```powershell
createdb -U postgres maturityflow
pg_restore -U postgres -d maturityflow --clean --if-exists .\recovery\database.dump
npm run db:migrate
npm run typecheck
npm test
npm run build
npm run start
```

Open `/api/health`, sign in, inspect the Register total, one case schedule, the current Cashbook,
one uploaded document and the Audit log before allowing branch users onto the restored system.

## Recovery drill

A backup is only proven after a restore. Quarterly, restore the newest archive into a temporary
database (never over production), compare the manifest/hash, run `npm run db:check`, and open the
five screens listed above. Record the drill date outside the archive.
