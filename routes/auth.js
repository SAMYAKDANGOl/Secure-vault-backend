const express = require("express")
const bcrypt = require("bcryptjs")
const crypto = require("crypto")
const { createClient } = require("@supabase/supabase-js")
const twilio = require("twilio")
const auditLogger = require("../utils/audit-logger")
const authMiddleware = require("../middleware/auth")

const router = express.Router()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const twilioClient = process.env.TWILIO_ACCOUNT_SID
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null

// Check if user has 2FA enabled
router.post("/check-2fa", async (req, res) => {
  try {
    const { userId } = req.body

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("two_factor_enabled, phone")
      .eq("user_id", userId)
      .single()

    if (profile?.two_factor_enabled) {
      // Generate temporary token
      const tempToken = crypto.randomBytes(32).toString("hex")

      // Store temp token with expiration
      await supabase.from("temp_tokens").insert({
        user_id: userId,
        token: tempToken,
        expires_at: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
      })

      // Send SMS code
      const code = Math.floor(100000 + Math.random() * 900000).toString()

      await supabase.from("verification_codes").insert({
        user_id: userId,
        code: await bcrypt.hash(code, 10),
        expires_at: new Date(Date.now() + 5 * 60 * 1000),
      })

      if (twilioClient && profile.phone) {
        await twilioClient.messages.create({
          body: `Your Secure Vault verification code is: ${code}`,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: profile.phone,
        })
      }

      res.json({
        requiresTwoFactor: true,
        tempToken,
        message: "Verification code sent to your phone",
      })
    } else {
      res.json({ requiresTwoFactor: false })
    }
  } catch (error) {
    console.error("2FA check error:", error)
    res.status(500).json({ error: "Failed to check 2FA status" })
  }
})

// Verify 2FA code
router.post("/verify-2fa", async (req, res) => {
  try {
    const { tempToken, code } = req.body

    // Verify temp token
    const { data: tokenData } = await supabase
      .from("temp_tokens")
      .select("user_id")
      .eq("token", tempToken)
      .gt("expires_at", new Date().toISOString())
      .single()

    if (!tokenData) {
      return res.status(400).json({ error: "Invalid or expired token" })
    }

    // Verify code
    const { data: codes } = await supabase
      .from("verification_codes")
      .select("code")
      .eq("user_id", tokenData.user_id)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })

    let codeValid = false
    for (const codeData of codes || []) {
      if (await bcrypt.compare(code, codeData.code)) {
        codeValid = true
        break
      }
    }

    if (!codeValid) {
      await auditLogger.log({
        userId: tokenData.user_id,
        action: "2fa_failed",
        resource: "/auth/verify-2fa",
        ipAddress: req.clientIP,
        userAgent: req.get("User-Agent"),
        success: false,
      })

      return res.status(400).json({ error: "Invalid verification code" })
    }

    // Generate new session tokens
    const { data: authData, error } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: tokenData.user_id, // This is a workaround for getting tokens
    })

    if (error) {
      throw error
    }

    // Clean up temp tokens and codes
    await supabase.from("temp_tokens").delete().eq("token", tempToken)
    await supabase.from("verification_codes").delete().eq("user_id", tokenData.user_id)

    await auditLogger.log({
      userId: tokenData.user_id,
      action: "2fa_success",
      resource: "/auth/verify-2fa",
      ipAddress: req.clientIP,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({
      success: true,
      accessToken: authData.properties?.access_token,
      refreshToken: authData.properties?.refresh_token,
    })
  } catch (error) {
    console.error("2FA verification error:", error)
    res.status(500).json({ error: "Failed to verify 2FA code" })
  }
})

// Setup 2FA for new users
router.post("/setup-2fa", authMiddleware, async (req, res) => {
  try {
    const { phone } = req.body
    const userId = req.user.id

    // Update user profile with 2FA settings
    await supabase.from("user_profiles").upsert({
      user_id: userId,
      two_factor_enabled: true,
      phone: phone,
      updated_at: new Date().toISOString(),
    })

    await auditLogger.log({
      userId,
      action: "2fa_setup",
      resource: "/auth/setup-2fa",
      ipAddress: req.clientIP,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({ success: true, message: "2FA enabled successfully" })
  } catch (error) {
    console.error("2FA setup error:", error)
    res.status(500).json({ error: "Failed to setup 2FA" })
  }
})

module.exports = router
