const express = require("express")
const { createClient } = require("@supabase/supabase-js")
const auditLogger = require("../utils/audit-logger")

const router = express.Router()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Get access control rules
router.get("/rules", async (req, res) => {
  try {
    const userId = req.user.id

    const { data: rules, error } = await supabase
      .from("access_control_rules")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })

    if (error) throw error

    res.json({ data: rules || [] })
  } catch (error) {
    console.error("Failed to fetch access rules:", error)
    res.status(500).json({ error: "Failed to fetch access rules" })
  }
})

// Create access control rule
router.post("/rules", async (req, res) => {
  try {
    const userId = req.user.id
    const { type, name, config } = req.body

    // Validate rule configuration
    if (!type || !name || !config) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    const validTypes = ["time", "location", "device"]
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: "Invalid rule type" })
    }

    const { data: rule, error } = await supabase
      .from("access_control_rules")
      .insert({
        user_id: userId,
        type,
        name,
        config,
        enabled: true,
      })
      .select()
      .single()

    if (error) throw error

    await auditLogger.log({
      userId,
      action: "access_rule_create",
      resource: `/access-control/rules/${rule.id}`,
      ipAddress: req.clientIP,
      userAgent: req.get("User-Agent"),
      success: true,
      details: { type, name },
    })

    res.json({ success: true, rule })
  } catch (error) {
    console.error("Failed to create access rule:", error)
    res.status(500).json({ error: "Failed to create access rule" })
  }
})

// Toggle access control rule
router.post("/rules/:id/toggle", async (req, res) => {
  try {
    const userId = req.user.id
    const ruleId = req.params.id
    const { enabled } = req.body

    const { data: rule, error } = await supabase
      .from("access_control_rules")
      .update({ enabled })
      .eq("id", ruleId)
      .eq("user_id", userId)
      .select()
      .single()

    if (error) throw error

    await auditLogger.log({
      userId,
      action: "access_rule_toggle",
      resource: `/access-control/rules/${ruleId}`,
      ipAddress: req.clientIP,
      userAgent: req.get("User-Agent"),
      success: true,
      details: { enabled },
    })

    res.json({ success: true, rule })
  } catch (error) {
    console.error("Failed to toggle access rule:", error)
    res.status(500).json({ error: "Failed to toggle access rule" })
  }
})

// Delete access control rule
router.delete("/rules/:id", async (req, res) => {
  try {
    const userId = req.user.id
    const ruleId = req.params.id

    const { error } = await supabase.from("access_control_rules").delete().eq("id", ruleId).eq("user_id", userId)

    if (error) throw error

    await auditLogger.log({
      userId,
      action: "access_rule_delete",
      resource: `/access-control/rules/${ruleId}`,
      ipAddress: req.clientIP,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({ success: true })
  } catch (error) {
    console.error("Failed to delete access rule:", error)
    res.status(500).json({ error: "Failed to delete access rule" })
  }
})

module.exports = router
