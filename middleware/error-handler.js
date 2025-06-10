const auditLogger = require("../utils/audit-logger")

const errorHandler = async (err, req, res, next) => {
  console.error("Error:", err)

  // Log error to audit trail
  if (req.user) {
    await auditLogger.log({
      userId: req.user.id,
      action: "error",
      resource: req.path,
      ipAddress: req.clientIP || req.ip,
      userAgent: req.get("User-Agent"),
      success: false,
      details: {
        error: err.message,
        stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
      },
    })
  }

  // Default error response
  let statusCode = 500
  let message = "Internal server error"

  // Handle specific error types
  if (err.name === "ValidationError") {
    statusCode = 400
    message = "Validation error"
  } else if (err.name === "UnauthorizedError") {
    statusCode = 401
    message = "Unauthorized"
  } else if (err.name === "ForbiddenError") {
    statusCode = 403
    message = "Forbidden"
  } else if (err.name === "NotFoundError") {
    statusCode = 404
    message = "Not found"
  } else if (err.code === "LIMIT_FILE_SIZE") {
    statusCode = 413
    message = "File too large"
  }

  // Send error response
  res.status(statusCode).json({
    error: message,
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
    ...(process.env.NODE_ENV === "development" && { details: err.message }),
  })
}

module.exports = errorHandler
