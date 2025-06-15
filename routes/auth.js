import { createClient } from '@supabase/supabase-js'
import express from 'express'
import { authMiddleware } from '../middleware/auth.js'
import { auditLogger } from '../utils/audit-logger.js'

const router = express.Router()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) throw error

    await auditLogger.log({
      userId: data.user.id,
      action: "login",
      resource: "/auth/login",
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({
      token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.fullName || data.user.email,
      },
    })
  } catch (error) {
    console.error("Login error:", error)
    res.status(401).json({ error: "Invalid email or password" })
  }
})

// Register
router.post("/register", async (req, res) => {
  try {
    const { email, password } = req.body

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    })

    if (error) throw error

    // Create user profile
    const { error: profileError } = await supabase
      .from("user_profiles")
      .insert({
        user_id: data.user.id,
        email: data.user.email,
        active: true,
        created_at: new Date().toISOString(),
      })

    if (profileError) throw profileError

    await auditLogger.log({
      userId: data.user.id,
      action: "register",
      resource: "/auth/register",
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({
      token: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        name: data.user.email,
      },
    })
  } catch (error) {
    console.error("Registration error:", error)
    res.status(400).json({ error: "Failed to create account" })
  }
})

// Logout
router.post("/logout", authMiddleware, async (req, res) => {
  try {
    const { error } = await supabase.auth.signOut()

    if (error) throw error

    await auditLogger.log({
      userId: req.user.id,
      action: "logout",
      resource: "/auth/logout",
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({ success: true })
  } catch (error) {
    console.error("Logout error:", error)
    res.status(500).json({ error: "Failed to logout" })
  }
})

// Get current user
router.get("/me", authMiddleware, async (req, res) => {
  try {
    const { data: profile, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", req.user.id)
      .single()

    if (error) throw error

    res.json({
      id: req.user.id,
      email: req.user.email,
      name: req.user.user_metadata?.fullName || req.user.email,
      profile,
    })
  } catch (error) {
    console.error("Get user error:", error)
    res.status(500).json({ error: "Failed to get user data" })
  }
})

// Forgot password
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.FRONTEND_URL}/auth/reset-password`,
    })

    if (error) throw error

    await auditLogger.log({
      userId: null,
      action: "forgot_password",
      resource: "/auth/forgot-password",
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      success: true,
      details: { email },
    })

    res.json({ success: true })
  } catch (error) {
    console.error("Forgot password error:", error)
    res.status(500).json({ error: "Failed to send reset email" })
  }
})

// Reset password
router.post("/reset-password", async (req, res) => {
  try {
    const { token, password } = req.body

    const { error } = await supabase.auth.updateUser({
      password,
    })

    if (error) throw error

    await auditLogger.log({
      userId: null,
      action: "reset_password",
      resource: "/auth/reset-password",
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({ success: true })
  } catch (error) {
    console.error("Reset password error:", error)
    res.status(400).json({ error: "Failed to reset password" })
  }
})

// Check MFA status
router.get("/mfa/status", authMiddleware, async (req, res) => {
  try {
    const { data: { factors }, error } = await supabase.auth.mfa.listFactors()
    
    if (error) throw error

    res.json({
      factors,
      hasMFA: factors.some(factor => factor.status === 'verified')
    })
  } catch (error) {
    console.error("MFA status check error:", error)
    res.status(500).json({ error: "Failed to check MFA status" })
  }
})

// Enroll in MFA
router.post("/mfa/enroll", authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp'
    })

    if (error) throw error

    await auditLogger.log({
      userId: req.user.id,
      action: "mfa_enroll",
      resource: "/auth/mfa/enroll",
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({
      success: true,
      data
    })
  } catch (error) {
    console.error("MFA enrollment error:", error)
    res.status(500).json({ error: "Failed to enroll in MFA" })
  }
})

// Verify MFA
router.post("/mfa/verify", authMiddleware, async (req, res) => {
  try {
    const { factorId, challengeId, code } = req.body

    const { data, error } = await supabase.auth.mfa.challenge({
      factorId,
      challengeId
    })

    if (error) throw error

    const { data: verifyData, error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code
    })

    if (verifyError) throw verifyError

    await auditLogger.log({
      userId: req.user.id,
      action: "mfa_verify",
      resource: "/auth/mfa/verify",
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({
      success: true,
      data: verifyData
    })
  } catch (error) {
    console.error("MFA verification error:", error)
    res.status(500).json({ error: "Failed to verify MFA" })
  }
})

// Unenroll from MFA
router.post("/mfa/unenroll", authMiddleware, async (req, res) => {
  try {
    const { factorId } = req.body

    const { error } = await supabase.auth.mfa.unenroll({
      factorId
    })

    if (error) throw error

    await auditLogger.log({
      userId: req.user.id,
      action: "mfa_unenroll",
      resource: "/auth/mfa/unenroll",
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({
      success: true,
      message: "MFA disabled successfully"
    })
  } catch (error) {
    console.error("MFA unenrollment error:", error)
    res.status(500).json({ error: "Failed to disable MFA" })
  }
})

export default router
