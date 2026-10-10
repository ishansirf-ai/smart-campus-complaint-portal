const AuditLog = require("../models/AuditLog");

async function writeAudit({
  req,
  actor = null,
  action,
  entityType = "",
  entityId = "",
  details = {}
}) {
  try {
    await AuditLog.create({
      actor: actor || req?.user?._id || null,
      action,
      entityType,
      entityId: String(entityId || ""),
      details,
      ipAddress: req?.ip || ""
    });
  } catch (error) {
    // Audit logging must not break the primary request.
    console.error("Audit log error:", error.message);
  }
}

module.exports = { writeAudit };
