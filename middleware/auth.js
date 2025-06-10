const { createClient } = require("@supabase/supabase-js")
const auditLogger = require("../utils/audit-logger")

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No valid authorization token provided" })
    }

    const token = authHeader.substring(7)

    // Verify JWT token with Supabase
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token)

    if (error || !user) {
      await auditLogger.log({
        userId: null,
        action: "auth_failed",
        resource: req.path,
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
        success: false,
        details: { error: "Invalid token" },
      })

      return res.status(401).json({ error: "Invalid or expired token" })
    }

    // Check if user is active
    const { data: profile } = await supabase.from("user_profiles").select("*").eq("user_id", user.id).single()

    if (profile && !profile.active) {
      return res.status(403).json({ error: "Account is deactivated" })
    }

    // Add user to request object
    req.user = user
    req.userProfile = profile

    // Log successful authentication
    await auditLogger.log({
      userId: user.id,
      action: "auth_success",
      resource: req.path,
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    next()
  } catch (error) {
    console.error("Auth middleware error:", error)

    await auditLogger.log({
      userId: null,
      action: "auth_error",
      resource: req.path,
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      success: false,
      details: { error: error.message },
    })

    res.status(500).json({ error: "Authentication service error" })
  }
}

module.exports = authMiddleware
