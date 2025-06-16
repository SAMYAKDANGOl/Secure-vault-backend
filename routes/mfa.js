const express = require("express")
const { 
  generateMFASecret, 
  generateQRCode, 
  verifyMFAToken, 
  generateBackupCodes, 
  verifyBackupCode 
} = require("../utils/mfa")

const router = express.Router()

// Setup MFA for user
router.post("/setup", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const userEmail = req.user.email

    console.log(`[${req.requestId}] MFA setup request for user:`, userId)

    // Check if MFA is already enabled
    const { data: existingProfile } = await supabase
      .from("user_profiles")
      .select("mfa_enabled, mfa_secret")
      .eq("user_id", userId)
      .single()

    if (existingProfile?.mfa_enabled) {
      return res.status(400).json({ error: "MFA is already enabled for this account" })
    }

    // Generate new MFA secret
    const mfaData = generateMFASecret(userId, userEmail)
    
    // Generate QR code
    const qrCodeDataUrl = await generateQRCode(mfaData.otpauthUrl)
    
    // Generate backup codes
    const backupCodes = generateBackupCodes(10)

    // Store secret temporarily (not enabled yet)
    await supabase
      .from("user_profiles")
      .upsert({
        user_id: userId,
        mfa_secret: mfaData.secret,
        mfa_backup_codes: backupCodes,
        mfa_enabled: false,
        updated_at: new Date().toISOString()
      })

    // Log audit
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "mfa_setup_initiated",
      resource: "/mfa/setup",
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      created_at: new Date().toISOString()
    })

    console.log(`[${req.requestId}] MFA setup initiated for user:`, userId)

    // Log response before sending
    console.log("Sending MFA setup response:", {
      success: true,
      qrCode: qrCodeDataUrl,
      secret: mfaData.secret,
      backupCodes: backupCodes,
      message: "Scan the QR code with your authenticator app and verify with a token"
    });
    res.json({
      success: true,
      qrCode: qrCodeDataUrl,
      secret: mfaData.secret,
      backupCodes: backupCodes,
      message: "Scan the QR code with your authenticator app and verify with a token"
    })
  } catch (error) {
    console.error(`[${req.requestId}] MFA setup error:`, error)
    res.status(500).json({ error: "Failed to setup MFA" })
  }
})

// Verify and enable MFA
router.post("/verify", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const { token, backupCode } = req.body

    console.log(`[${req.requestId}] MFA verification request for user:`, userId)

    if (!token && !backupCode) {
      return res.status(400).json({ error: "Token or backup code is required" })
    }

    // Get user profile
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("mfa_secret, mfa_backup_codes, mfa_enabled")
      .eq("user_id", userId)
      .single()

    if (!profile) {
      return res.status(404).json({ error: "User profile not found" })
    }

    if (profile.mfa_enabled) {
      return res.status(400).json({ error: "MFA is already enabled" })
    }

    let isValid = false
    let remainingBackupCodes = profile.mfa_backup_codes || []

    if (backupCode) {
      // Verify backup code
      const backupResult = verifyBackupCode(remainingBackupCodes, backupCode)
      isValid = backupResult.success
      remainingBackupCodes = backupResult.remainingCodes
    } else if (token) {
      // Verify TOTP token
      isValid = verifyMFAToken(profile.mfa_secret, token)
    }

    if (!isValid) {
      // Log failed attempt
      await supabase.from("audit_logs").insert({
        user_id: userId,
        action: "mfa_verification_failed",
        resource: "/mfa/verify",
        ip_address: req.clientIP,
        user_agent: req.get("User-Agent"),
        success: false,
        created_at: new Date().toISOString()
      })

      return res.status(400).json({ error: "Invalid token or backup code" })
    }

    // Enable MFA
    await supabase
      .from("user_profiles")
      .update({
        mfa_enabled: true,
        mfa_backup_codes: remainingBackupCodes,
        mfa_enabled_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("user_id", userId)

    // Log successful verification
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "mfa_enabled",
      resource: "/mfa/verify",
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      created_at: new Date().toISOString()
    })

    console.log(`[${req.requestId}] MFA enabled for user:`, userId)

    res.json({
      success: true,
      message: "MFA has been enabled successfully",
      remainingBackupCodes: remainingBackupCodes.length
    })
  } catch (error) {
    console.error(`[${req.requestId}] MFA verification error:`, error)
    res.status(500).json({ error: "Failed to verify MFA" })
  }
})

// Disable MFA
router.post("/disable", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const { token, backupCode } = req.body

    console.log(`[${req.requestId}] MFA disable request for user:`, userId)

    if (!token && !backupCode) {
      return res.status(400).json({ error: "Token or backup code is required" })
    }

    // Get user profile
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("mfa_secret, mfa_backup_codes, mfa_enabled")
      .eq("user_id", userId)
      .single()

    if (!profile || !profile.mfa_enabled) {
      return res.status(400).json({ error: "MFA is not enabled" })
    }

    let isValid = false
    let remainingBackupCodes = profile.mfa_backup_codes || []

    if (backupCode) {
      // Verify backup code
      const backupResult = verifyBackupCode(remainingBackupCodes, backupCode)
      isValid = backupResult.success
      remainingBackupCodes = backupResult.remainingCodes
    } else if (token) {
      // Verify TOTP token
      isValid = verifyMFAToken(profile.mfa_secret, token)
    }

    if (!isValid) {
      return res.status(400).json({ error: "Invalid token or backup code" })
    }

    // Disable MFA
    await supabase
      .from("user_profiles")
      .update({
        mfa_enabled: false,
        mfa_secret: null,
        mfa_backup_codes: null,
        mfa_disabled_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq("user_id", userId)

    // Log successful disable
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "mfa_disabled",
      resource: "/mfa/disable",
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      created_at: new Date().toISOString()
    })

    console.log(`[${req.requestId}] MFA disabled for user:`, userId)

    res.json({
      success: true,
      message: "MFA has been disabled successfully"
    })
  } catch (error) {
    console.error(`[${req.requestId}] MFA disable error:`, error)
    res.status(500).json({ error: "Failed to disable MFA" })
  }
})

// Get MFA status
router.get("/status", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id

    console.log(`[${req.requestId}] MFA status request for user:`, userId)

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("mfa_enabled, mfa_backup_codes")
      .eq("user_id", userId)
      .single()

    res.json({
      success: true,
      mfaEnabled: profile?.mfa_enabled || false,
      backupCodesRemaining: profile?.mfa_backup_codes?.length || 0
    })
  } catch (error) {
    console.error(`[${req.requestId}] MFA status error:`, error)
    res.status(500).json({ error: "Failed to get MFA status" })
  }
})

// Generate new backup codes
router.post("/backup-codes", async (req, res) => {
  try {
    const supabase = req.app.locals.supabase
    const userId = req.user.id
    const { token } = req.body

    console.log(`[${req.requestId}] Backup codes generation request for user:`, userId)

    if (!token) {
      return res.status(400).json({ error: "Token is required" })
    }

    // Get user profile
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("mfa_secret, mfa_enabled")
      .eq("user_id", userId)
      .single()

    if (!profile || !profile.mfa_enabled) {
      return res.status(400).json({ error: "MFA is not enabled" })
    }

    // Verify token
    const isValid = verifyMFAToken(profile.mfa_secret, token)
    if (!isValid) {
      return res.status(400).json({ error: "Invalid token" })
    }

    // Generate new backup codes
    const newBackupCodes = generateBackupCodes(10)

    // Update backup codes
    await supabase
      .from("user_profiles")
      .update({
        mfa_backup_codes: newBackupCodes,
        updated_at: new Date().toISOString()
      })
      .eq("user_id", userId)

    // Log backup codes generation
    await supabase.from("audit_logs").insert({
      user_id: userId,
      action: "mfa_backup_codes_regenerated",
      resource: "/mfa/backup-codes",
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      created_at: new Date().toISOString()
    })

    console.log(`[${req.requestId}] New backup codes generated for user:`, userId)

    res.json({
      success: true,
      backupCodes: newBackupCodes,
      message: "New backup codes generated successfully"
    })
  } catch (error) {
    console.error(`[${req.requestId}] Backup codes generation error:`, error)
    res.status(500).json({ error: "Failed to generate backup codes" })
  }
})

module.exports = router 