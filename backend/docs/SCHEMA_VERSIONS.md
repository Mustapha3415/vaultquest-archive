# Schema Version Management

This document describes the versioned API response contracts for VaultQuest contributor integrations. It covers the core response schemas, contract testing, and the versioning and deprecation rules that keep external and internal consumers stable.

## Overview

VaultQuest exposes a JSON API whose response shapes are treated as contracts. Every core response is validated against a machine-readable schema during tests. Breaking changes must fail contract tests before they reach consumers.

The contracts are organized by domain:

- **Vault accounting** - balances, deposits, withdrawals, and yield accrual.
- -*Prize draws** - draw schedules, winners, and prize distribution.
- -*Wallet flows** - connection state, signature requests, and transaction receipts.
- **User dashboards** - account summaries and activity feeds.
- -*Protocol reporting** - aggregated protocol metrics and time-series data.

## Versioning Scheme

Versions follow semantic versioning and are encoded in the response envelope as `schemaVersion`.

```json
{
  "schemaVersion": "1.0.0",
  "data": { ... },
  "error": null,
  "meta": {
    "requestId": "01HXXXXXXXXXXXXXXXXXXXXXX",
    "generatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

- -*MAJOR** - increased for breaking changes. Consumers must opt in to a new major version.
- **MINOR** - increased for backward-compatible additions (new optional fields).
- **PATCH** - increased for documentation or non-shape clarifications.

The current supported major version is `1.0.0`. Responses without a `schemaVersion` field are considered legacy and are rejected by contract tests.

## Core Response Schemas

All schemas live in `backend/src/schemas/` and are exported as Zod objects. The shared envelope is defined in `backend/src/schemas/envelope.ts`.

| Schema | File | Description |
| --- | --- | --- |
| `VaulBalanceResponse` | `balance.ts` | Vault balance and yield accrual for a wallet. |
| `PrizeDrawResponse` | `prizeDraw.ts` | Draw schedule, winners, and distribution. |
| `WalletConnectionResponse` | `wallet.ts` | Wallet connection and signature state. |
| `DashboardSummaryResponse` | `dashboard.ts` | User dashboard summary and activity feed. |
| `ProtocolReportResponse` | `reporting.ts` | Aggregated protocol metrics and time-series data. |

### Success Response Example

```json
{
  "schemaVersion": "1.0.0",
  "data": {
    "vaultId": "vault-1",
    "walletAddress": "0x0000000000000000000000000000000000000000",
    "balance": "10000000000000000000",
    "yieldAccrued": "500000000000000000",
    "asset": "USDC",
    "updatedAt": "2024-01-01T00:00:00.000Z"
  },
  "error": null,
  "meta": {
    "requestId": "01HXXXXXXXXXXXXXXXXXXXXXX",
    "generatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### Error Response Example

```json
{
  "schemaVersion": "1.0.0",
  "data": null,
  "error": {
    "code": "VAULT_NOT_FOUND",
    "message": "Vault vault-1 does not exist.",
    "details": {
      "vaultId": "vault-1"
    }
  },
  "meta": {
    "requestId": "01HXXXXXXXXXXXXXXXXXXXXXX",
    "generatedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

## Contract Testing

Contract tests validate recorded fixtures against the current schemas. They live in `backend/tests/contracts/` and are executed with:

```bash
npm run test:contracts
```

The suite fails when:

- A response is missing `data`, `error`, or `meta`.
- A field is removed or changes type without a major version bump.
- A new required field is added without a major version bump.
- The `schemaVersion` does not match the schema used to validate the response.

Fixtures are stored in `backend/tests/contracts/fixtures/` and are named `<domain>.<version>.json`. Adding a fixture without a corresponding schema update is a contract failure.

## Deprecation Rules

- A deprecated field must be marked in the schema with `.describe('deprecated')` and documented here.
- Deprecated fields remain present for at least one minor release cycle before removal.
- Removal of a deprecated field requires a major version bump and a migration note in this document.
- Consumers should ignore unknown fields and must not rely on field ordering.

## Change Checklist

When changing a core response:

1. Update the Zod schema in `backend/src/schemas/`.
2. Add or update a fixture in `backend/tests/contracts/fixtures/`.
3. Run `npm run test:contracts`.
4. Update this document if the version or deprecation status changes.
5. Note any migration steps in the pull request description.
This document describes the schema versioning strategy for VaultQuest legacy
records, the fixture pack used to exercise migrations and compatibility layers,
and the provenance of each fixture.

## Legacy fixture pack

Fixtures live under `backend/tests/fixtures/legacy/` and are named by the schema
version they represent. Each fixture is a JSON document that validates against
the historical shape for that version.

| Fixture | Schema version | Coverage |
| --- | --- | --- |
| `v0_clean.json` | v0 | Clean legacy record with all required fields present. |
| `v0_missing_field.json` | v0 | Legacy record missing a required field (`prizePool`). |
| `v0_deprecated_field.json` | v0 | Legacy record containing a deprecated field (`legacyYield`). |
| `v0_incompatible.json` | v0 | Legacy record with an unknown schema version marker. |

## Provenance

Fixtures were derived from anonymized production snapshots captured before the
v1 migration. Field names and value ranges reflect the v0 storage layout used by
the original vault accounting module. No live user data is included; identifiers
and amounts were replaced with deterministic placeholders.

## Migration coverage

`backend/tests/migration/legacyMigration.test.ts` loads each fixture and runs it
through the migration pipeline. The suite asserts:

- Clean legacy records migrate to a current valid record.
- Records with missing required fields are rejected with a descriptive error.
- Deprecated fields are dropped and do not appear on the migrated record.
- Incompatible legacy records fail validation before migration runs.

Run the suite with:

