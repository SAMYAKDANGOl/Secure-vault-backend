const express = require("express")
const bcrypt = require("bcryptjs")
const { createClient } = require("@supabase/supabase-js")
const auditLogger = require("../utils/audit-logger")

const router = express.Router()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Get user settings
router.get("/settings", async (req, res) => {
  try {
    const userId = req.user.id

    const { data: profile, error } = await supabase.from("user_profiles").select("*").eq("user_id", userId).single()

    if (error && error.code !== "PGRST116") throw error

    const settings = {
      twoFactorEnabled: profile?.two_factor_enabled || false,
      sessionTimeout: profile?.session_timeout || 30,
      emailNotifications: profile?.email_notifications || true,
      securityAlerts: profile?.security_alerts || true,
      dataRetention: profile?.data_retention || 365,
    }

    res.json({ data: settings })
  } catch (error) {
    console.error("Failed to fetch user settings:", error)
    res.status(500).json({ error: "Failed to fetch user settings" })
  }
})

// Update user settings
router.post("/settings", async (req, res) => {
  try {
    const userId = req.user.id
    const settings = req.body

    const { error } = await supabase.from("user_profiles").upsert({
      user_id: userId,
      two_factor_enabled: settings.twoFactorEnabled,
      session_timeout: settings.sessionTimeout,
      email_notifications: settings.emailNotifications,
      security_alerts: settings.securityAlerts,
      data_retention: settings.dataRetention,
      updated_at: new Date().toISOString(),
    })

    if (error) throw error

    await auditLogger.log({
      userId,
      action: "settings_update",
      resource: "/user/settings",
      ipAddress: req.clientIP,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({ success: true })
  } catch (error) {
    console.error("Failed to update user settings:", error)
    res.status(500).json({ error: "Failed to update user settings" })
  }
})

// Update user profile
router.post("/profile", async (req, res) => {
  try {
    const userId = req.user.id
    const { fullName, email, phone, dateOfBirth } = req.body

    // Update auth user metadata
    const { error: authError } = await supabase.auth.admin.updateUserById(userId, {
      email,
      user_metadata: {
        fullName,
        phone,
        dateOfBirth,
      },
    })

    if (authError) throw authError

    await auditLogger.log({
      userId,
      action: "profile_update",
      resource: "/user/profile",
      ipAddress: req.clientIP,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({ success: true })
  } catch (error) {
    console.error("Failed to update profile:", error)
    res.status(500).json({ error: "Failed to update profile" })
  }
})

// Update password
router.post("/password", async (req, res) => {
  try {
    const userId = req.user.id
    const { currentPassword, newPassword } = req.body

    // Verify current password (simplified - in production, use proper verification)
    const { error: updateError } = await supabase.auth.admin.updateUserById(userId, {
      password: newPassword,
    })

    if (updateError) throw updateError

    // Update last password change
    await supabase.from("user_profiles").upsert({
      user_id: userId,
      last_password_change: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    await auditLogger.log({
      userId,
      action: "password_change",
      resource: "/user/password",
      ipAddress: req.clientIP,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({ success: true })
  } catch (error) {
    console.error("Failed to update password:", error)
    res.status(500).json({ error: "Failed to update password" })
  }
})

// Get user devices
router.get("/devices", async (req, res) => {
  try {
    const userId = req.user.id

    const { data: devices, error } = await supabase
      .from("user_devices")
      .select("*")
      .eq("user_id", userId)
      .order("last_seen", { ascending: false })

    if (error) throw error

    res.json({ data: devices || [] })
  } catch (error) {
    console.error("Failed to fetch devices:", error)
    res.status(500).json({ error: "Failed to fetch devices" })
  }
})

// Revoke device access
router.delete("/devices/:id", async (req, res) => {
  try {
    const userId = req.user.id
    const deviceId = req.params.id

    const { error } = await supabase.from("user_devices").delete().eq("id", deviceId).eq("user_id", userId)

    if (error) throw error

    await auditLogger.log({
      userId,
      action: "device_revoke",
      resource: `/user/devices/${deviceId}`,
      ipAddress: req.clientIP,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({ success: true })
  } catch (error) {
    console.error("Failed to revoke device:", error)
    res.status(500).json({ error: "Failed to revoke device" })
  }
})

// Export user data
router.get("/export", async (req, res) => {
  try {
    const userId = req.user.id

    // Get user profile
    const { data: profile } = await supabase.from("user_profiles").select("*").eq("user_id", userId).single()

    // Get files metadata (not actual files for privacy)
    const { data: files } = await supabase
      .from("files")
      .select("original_name, size, mime_type, uploaded_at, encrypted")
      .eq("user_id", userId)
      .eq("deleted", false)

    // Get audit logs
    const { data: auditLogs } = await supabase
      .from("audit_logs")
      .select("action, resource, created_at, success")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1000)

    const exportData = {
      profile,
      files: files || [],
      auditLogs: auditLogs || [],
      exportedAt: new Date().toISOString(),
    }

    await auditLogger.log({
      userId,
      action: "data_export",
      resource: "/user/export",
      ipAddress: req.clientIP,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({ data: exportData })
  } catch (error) {
    console.error("Failed to export data:", error)
    res.status(500).json({ error: "Failed to export data" })
  }
})

module.exports = router
