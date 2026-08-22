const mongoose = require("mongoose");

/**
 * Every canonical Tally record produced by the parsers shares one envelope:
 * it is scoped to a company, identified by a stable object id, and carries a
 * checksum. The mirror leans on all three - companyId to isolate tenants,
 * sourceObjectId as the upsert key, checksum to detect real change.
 *
 * The schema is deliberately non-strict. Each object type carries a different
 * body (a Ledger has openingBalance, a StockItem has units), and a financial
 * mirror must never silently drop a field the parser produced. Declared paths
 * exist only to be indexed and queried; everything else is stored verbatim.
 */
function buildMirrorSchema(objectType, collectionName) {
  const schema = new mongoose.Schema(
    {
      companyId: { type: String, required: true },
      sourceObjectId: { type: String, required: true },
      objectType: { type: String, default: objectType },
      name: { type: String, default: null },
      parent: { type: String, default: null },

      // The parser's own checksum, stored verbatim as part of the canonical
      // record. Not used for change detection: it folds in a per-run id and so
      // changes on every extraction.
      checksum: { type: String, default: null },

      // Change detection: hash of the record with volatile fields removed.
      contentHash: { type: String, default: null },

      // Tally has no delete feed. A record that stops appearing in an extraction
      // is tombstoned rather than removed, so history and audit stay intact.
      isDeleted: { type: Boolean, default: false },
      deletedAt: { type: Date, default: null },

      syncedAt: { type: Date, default: Date.now },
      lastRunId: { type: String, default: null }
    },
    {
      strict: false,
      timestamps: true,
      collection: collectionName,
      minimize: false
    }
  );

  // One row per object per company; this pair is also the upsert key.
  schema.index({ companyId: 1, sourceObjectId: 1 }, { unique: true });
  schema.index({ companyId: 1, isDeleted: 1 });
  schema.index({ companyId: 1, name: 1 });

  return schema;
}

/** Guard against redefining a model when the module graph is re-evaluated. */
function buildMirrorModel(modelName, objectType, collectionName) {
  if (mongoose.models[modelName]) return mongoose.models[modelName];
  return mongoose.model(modelName, buildMirrorSchema(objectType, collectionName));
}

module.exports = { buildMirrorSchema, buildMirrorModel };
