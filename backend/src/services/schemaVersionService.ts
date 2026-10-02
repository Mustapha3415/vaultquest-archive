import type { PrismaClient } from "@prisma/client";
import { SCHEMA_VERSIONS, getVersionMismatch } from "../constants.js";

/**
 * Versioned API response contract for schema version endpoints.
 *
 * Versioning rules:
 * - The `version` field is a monotonically increasing integer per response type.
 * - Adding optional fields is a non-breaking change and does not bump the version.
 * - Removing fields, changing field types, or making optional fields required is a
 *   breaking change and MUST bump the version and update the schema below.
 * - Deprecated fields are retained for at least one major version and marked with
 *   `deprecated: true` in the schema before removal.
 */
export const SCHEMA_VERSION_RESPONSE_VERSION = 1;

/**
 * JSON schema for the schema version validation response.
 * Used by contract tests to detect breaking changes early.
 */
export const schemaVersionResponseSchema = {
  $id: "https://vaultquest.dev/schemas/schema-version-response.json",
  type: "object",
  required: ["version", "valid", "databaseVersion", "indexerVersion", "issues"],
  additionalProperties: false,
  properties: {
    version: { type: "integer", const: SCHEMA_VERSION_RESPONSE_VERSION },
    valid: { type: "boolean" },
    databaseVersion: { type: "string" },
    indexerVersion: { type: "string" },
    issues: { type: "array", items: { type: "string" } },
  },
} as const;

/**
 * JSON schema for the schema version info response.
 */
export const schemaVersionInfoResponseSchema = {
  $id: "https://vaultquest.dev/schemas/schema-version-info-response.json",
  type: "object",
  required: ["version", "database", "indexer"],
  additionalProperties: false,
  properties: {
    version: { type: "integer", const: SCHEMA_VERSION_RESPONSE_VERSION },
    database: {
      type: "object",
      required: ["current", "expected", "supported"],
      additionalProperties: false,
      properties: {
        current: { type: "string" },
        expected: { type: "string" },
        supported: { type: "array", items: { type: "string" } },
      },
    },
    indexer: {
      type: "object",
      required: ["current", "expected", "supported"],
      additionalProperties: false,
      properties: {
        current: { type: "string" },
        expected: { type: "string" },
        supported: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;
 * Legacy record shapes from previous VaultQuest schemas.
 * These are used by migration/compatibility tests to verify that old
 * records can be reade and upgraded to the current shape.
 */
export interface LegacyVaultRecord {
  id: string;
  address: string;
  ownerAddress: string;
  totalDeposits: string;
  totalWithdrawals?: string;
  createdAt: string;
  schemaVersion: string;
}

export interface LegacyPrizeRecord {
  id: string;
  vaultId: string;
  winnerAddress: string;
  amount: string;
  drawId: string;
  drawnAt: string;
  schemaVersion: string;
}

export interface LegacyWalletRecord {
  id: string;
  address: string;
  balance?: string;
  lastSeenAt: string;
  schemaVersion: string;
}

export type LegacyRecord = LegacyVaultRecord | LegacyPrizeRecord | LegacyWalletRecord;

export interface CurrentVaultRecord {
  id: string;
  address: string;
  ownerAddress: string;
  totalDeposits: string;
  totalWithdrawals: string;
  createdAt: string;
  schemaVersion: string;
  migratedFrom?: string;
}

export interface CurrentPrizeRecord {
  id: string;
  vaultId: string;
  winnerAddress: string;
  amount: string;
  drawId: string;
  drawnAt: string;
  schemaVersion: string;
  migratedFrom?: string;
}

export interface CurrentWalletRecord {
  id: string;
  address: string;
  balance: string;
  lastSeenAt: string;
  schemaVersion: string;
  migratedFrom?: string;
}

export type CurrentRecord = CurrentVaultRecord | CurrentPrizeRecord | CurrentWalletRecord;

export interface MigrationResult {
  ok: boolean;
  record?: CurrentRecord;
  issues: string;
}

/**
 * Known legacy schema versions that this service can migrate.
 */
export const LEGACY_SCHEMA_VERSIONS = ["1.0.0", "1.1.0", "1.2.0"] as const;

/**
 * Service for validating database and indexer schema versions
 * Prevents deployment with incompatible schemas
 */
export class SchemaVersionService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get current database schema version from migrations
   */
  async getDatabaseVersion(): Promise<string> {
    try {
      // Query the _prisma_migrations table to get the latest applied migration
      const result = await this.prisma.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name 
        FROM _prisma_migrations 
        ORDER BY finished_at DESC 
        LIMIT 1
      `;
      
      if (result && result.length > 0) {
        // Extract version from migration name (e.g., "20260725000002_add_wallet_auth")
        const migrationName = result[0].migration_name;
        const versionMatch = migrationName.match(/^(\d{14})/);
        return versionMatch ? versionMatch[1] : "unknown";
      }
      
      return "unknown";
    } catch (error) {
      console.error("Failed to get database version:", error);
      return "unknown";
    }
  }

  /**
   * Get current indexer schema version
   * Reads from the indexer_version field populated by the indexer on startup.
   */
  async getIndexerVersion(): Promise<string> {
    try {
      const checkpoint = await this.prisma.indexerCheckpoint.findUnique({
        where: { id: "singleton" },
      });
      
      // Reads the real version from the checkpoint table
      return checkpoint?.indexerVersion || "unknown";
    } catch (error) {
      console.error("Failed to get indexer version:", error);
      return "unknown";
    }
  }

  /**
   * Perform preflight validation check
   * Throws error if schemas are incompatible
   */
  async validateSchemaVersions(): Promise<{
    version: number;
    valid: boolean;
    databaseVersion: string;
    indexerVersion: string;
    issues: string[];
  }> {
    const dbVersion = await this.getDatabaseVersion();
    const indexerVersion = await this.getIndexerVersion();
    
    const { compatible, issues } = getVersionMismatch(dbVersion, indexerVersion);
    
    return {
      version: SCHEMA_VERSION_RESPONSE_VERSION,
      valid: compatible,
      databaseVersion: dbVersion,
      indexerVersion: indexerVersion,
      issues,
    };
  }

  /**
   * Get version information for monitoring
   */
  async getVersionInfo() {
    const dbVersion = await this.getDatabaseVersion();
    const indexerVersion = await this.getIndexerVersion();
    
    return {
      version: SCHEMA_VERSION_RESPONSE_VERSION,
      database: {
        current: dbVersion,
        expected: SCHEMA_VERSIONS.DATABASE,
        supported: SCHEMA_VERSIONS.SUPPORTED_DATABASE_VERSIONS,
      },
      indexer: {
        current: indexerVersion,
        expected: SCHEMA_VERSIONS.INDEXER,
        supported: SCHEMA_VERSIONS.SUPPORTED_INDEXER_VERSIONS,
      },
    };
  }

  /**
   * Validate a legacy record against its expected old shape.
   * Returns an array of issues (strings); empty means the record is valid.
   */
  validateLegacyRecord(record: unknown): string[] {
    const issues: string[] = [];

    if (!record || typeof record !== "object") {
      return ["record is not an object"];
    }

    const r = record as Record<string, unknown>;

    if (typeof r.id !== "string" || r.id.length === 0) {
      issues.push("missing or invalid required field: id");
    }

    if (typeof r.schemaVersion !== "string") {
      issues.push("missing or invalid required field: schemaVersion");
    } else if (!LEGACY_SCHEMA_VERSIONS.includes(r.schemaVersion as (typeof LEGACY_SCHEMA_VERSIONS)[number])) {
      issues.push(`unsupported legacy schemaVersion: ${r.schemaVersion}`);
    }

    // Discriminate by known legacy field sets.
    if "vaultId" in r || "winnerAddress" in r) {
      // Legacy prize record
      for (const field of ["vaultId", "winnerAddress", "amount", "drawId", "drawnAt"]) {
        if (typeof r[field] !== "string" || (r[field] as string).length === 0) {
          issues.push(`missing or invalid required field: ${field}`);
        }
      }
    } else if ("ownerAddress" in r || "totalDeposits" in r) {
      // Legacy vault record
      for (const field of ["address", "ownerAddress", "totalDeposits", "createdAt"]) {
        if (typeof r[field] !== "string" || (r[field] as string).length === 0) {
          issues.push(`missing or invalid required field: ${field}`);
        }
      }
    } else if ("address" in r) {
      // Legacy wallet record
      for (const field of ["address", "lastSeenAt"]) {
        if (typeof r[field] !== "string" || (r[field] as string).length === 0) {
          issues.push(`missing or invalid required field: ${field}`);
        }
      }
    } else {
      issues.push("unrecognized legacy record shape");
    }

    return issues;
  }

  /**
   * Migrate a legacy record to the current shape.
   * Returns a result with either the migrated record or the issues encountered.
   */
  migrateLegacyRecord(record: unknown): MigrationResult {
    const issues = this.validateLegacyRecord(record);
    if (issues.length > 0) {
      return { ok: false, issues: issues.join("; ") };
    }

    const r = record as Record<string, unknown>;
    const migratedFrom = r.schemaVersion as string;

    if ("vaultId" in r) {
      const current: CurrentPrizeRecord = {
        id: r.id as string,
        vaultId: r.vaultId as string,
        winnerAddress: r.winnerAddress as string,
        amount: r.amount as string,
        drawId: r.drawId as string,
        drawnAt: r.drawnAt as string,
        schemaVersion: SCHEMA_VERSIONS.DATABASE,
        migratedFrom,
      };
      return { ok: true, record: current, issues: "" };
    }

    if ("ownerAddress" in r) {
      const current: CurrentVaultRecord = {
        id: r.id as string,
        address: r.address as string,
        ownerAddress: r.ownerAddress as string,
        totalDeposits: r.totalDeposits as string,
        totalWithdrawals: (r.totalWithdrawals as string || "0"),
        createdAt: r.createdAt as string,
        schemaVersion: SCHEMA_VERSIONS.DATABASE,
        migratedFrom,
      };
      return { ok: true, record: current, issues: "" };
    }

    const current: CurrentWalletRecord = {
      id: r.id as string,
      address: r.address as string,
      balance: (r.balance as string || "0"),
      lastSeenAt: r.lastSeenAt as string,
      schemaVersion: SCHEMA_VERSIONS.DATABASE,
      migratedFrom,
    };
    return { ok: true, record: current, issues: "" };
  }
}
