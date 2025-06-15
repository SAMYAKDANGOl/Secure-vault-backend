const express = require("express")
const router = express.Router()

router.get("/", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    console.log(`[${req.requestId}] Getting stats for user:`, userId)

    // Get user's files from Supabase
    const { data: files, error: filesError } = await supabase
      .from("files")
      .select("*")
      .eq("user_id", userId)
      .eq("deleted", false)

    if (filesError) {
      console.error(`[${req.requestId}] Files error:`, filesError)
      throw filesError
    }

    console.log(`[${req.requestId}] Found ${files.length} files for stats`)

    // Calculate total size
    const totalSize = files.reduce((sum, file) => sum + (file.size || 0), 0)

    // Find last upload
    const lastUpload =
      files.length > 0 ? new Date(Math.max(...files.map((f) => new Date(f.created_at).getTime()))) : null

    // Count shared files
    const activeShares = files.filter((file) => file.shared).length

    // Get security score from user profile
    const { data: profile, error: profileError } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", userId)
      .single()

    // Calculate security score
    let securityScore = 50 // Base score

    if (profile?.two_factor_enabled) securityScore += 20
    if (files.some((f) => f.encrypted)) securityScore += 15
    if (profile?.security_alerts) securityScore += 5
    if (files.length > 0) securityScore += 10

    const stats = {
      totalFiles: files.length,
      totalSize,
      lastUpload: lastUpload ? lastUpload.toLocaleDateString() : "Never",
      activeShares,
      securityScore: Math.min(securityScore, 100),
    }

    console.log(`[${req.requestId}] Stats calculated:`, stats)

    // Log audit
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "stats_view",
      resource: "/stats",
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      created_at: new Date().toISOString(),
    })

    res.json({ data: stats })
  } catch (error) {
    console.error(`[${req.requestId}] Stats error:`, error)
    res.status(500).json({ error: "Failed to fetch statistics" })
  }
})

module.exports = router
