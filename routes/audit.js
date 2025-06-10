const express = require("express")
const { createClient } = require("@supabase/supabase-js")

const router = express.Router()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Get audit logs
router.get("/logs", async (req, res) => {
  try {
    const userId = req.user.id
    const { filter = "all", range = "7d", search = "" } = req.query

    let query = supabase
      .from("audit_logs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100)

    // Apply date range filter
    const now = new Date()
    let startDate
    switch (range) {
      case "1d":
        startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000)
        break
      case "7d":
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        break
      case "30d":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        break
      case "90d":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
        break
      default:
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    }

    query = query.gte("created_at", startDate.toISOString())

    // Apply action filter
    if (filter !== "all") {
      query = query.eq("action", filter)
    }

    // Apply search filter
    if (search) {
      query = query.or(`resource.ilike.%${search}%,ip_address.ilike.%${search}%`)
    }

    const { data: logs, error } = await query

    if (error) throw error

    // Transform logs for frontend
    const transformedLogs = logs.map((log) => ({
      id: log.id,
      action: log.action,
      resource: log.resource,
      timestamp: log.created_at,
      ipAddress: log.ip_address,
      userAgent: log.user_agent,
      location: log.location,
      success: log.success,
      details: log.details,
    }))

    res.json({ data: transformedLogs })
  } catch (error) {
    console.error("Failed to fetch audit logs:", error)
    res.status(500).json({ error: "Failed to fetch audit logs" })
  }
})

module.exports = router
