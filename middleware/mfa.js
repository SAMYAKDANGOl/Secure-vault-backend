const { isMFARequired, verifyMFAToken, verifyBackupCode } = require("../utils/mfa")

/**
 * Middleware to check if MFA is required for an action
 * @param {string} action - The action being performed
 * @returns {Function} - Express middleware function
 */
function mfaCheck(action) {
  return async (req, res, next) => {
    try {
      const supabase = req.app.locals.supabase
      const userId = req.user.id

      // Get user profile
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("mfa_enabled, mfa_secret, mfa_backup_codes")
        .eq("user_id", userId)
        .single()

      // Check if MFA is required for this action
      if (!isMFARequired(profile, action)) {
        return next()
      }

      // MFA is required, check for token or backup code
      const { mfaToken, backupCode } = req.body

      if (!mfaToken && !backupCode) {
        return res.status(403).json({
          error: "MFA verification required",
          mfaRequired: true,
          action: action
        })
      }

      let isValid = false
      let remainingBackupCodes = profile.mfa_backup_codes || []

      if (backupCode) {
        // Verify backup code
        const backupResult = verifyBackupCode(remainingBackupCodes, backupCode)
        isValid = backupResult.success
        
        if (isValid) {
          // Update remaining backup codes
          await supabase
            .from("user_profiles")
            .update({
              mfa_backup_codes: backupResult.remainingCodes,
              updated_at: new Date().toISOString()
            })
            .eq("user_id", userId)
        }
      } else if (mfaToken) {
        // Verify TOTP token
        isValid = verifyMFAToken(profile.mfa_secret, mfaToken)
      }

      if (!isValid) {
        // Log failed MFA attempt
        await supabase.from("audit_logs").insert({
          user_id: userId,
          action: "mfa_verification_failed",
          resource: req.path,
          ip_address: req.clientIP,
          user_agent: req.get("User-Agent"),
          success: false,
          details: { requiredAction: action },
          created_at: new Date().toISOString()
        })

        return res.status(403).json({
          error: "Invalid MFA token or backup code",
          mfaRequired: true,
          action: action
        })
      }

      // MFA verification successful, proceed
      next()
    } catch (error) {
      console.error(`[${req.requestId}] MFA middleware error:`, error)
      res.status(500).json({ error: "MFA verification service error" })
    }
  }
}

module.exports = {
  mfaCheck
} 