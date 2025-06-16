const express = require("express")
const bcrypt = require("bcryptjs")
const crypto = require("crypto")
const { createClient } = require("@supabase/supabase-js")
const twilio = require("twilio")
const auditLogger = require("../utils/audit-logger")
const authMiddleware = require("../middleware/auth")
const speakeasy = require('speakeasy')
const QRCode = require('qrcode')
const { generateBackupCodes } = require('../utils/mfa')
const nodemailer = require('nodemailer')

const router = express.Router()

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

const twilioClient = process.env.TWILIO_ACCOUNT_SID
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null

// Check if user has 2FA enabled
router.post("/check-2fa", async (req, res) => {
  try {
    const { userId } = req.body

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" })
    }

    const { data: profile } = await supabase
      .from("user_profiles")
      .select("two_factor_enabled, phone")
      .eq("user_id", userId)
      .single()

    if (profile?.two_factor_enabled) {
      res.json({
        requiresTwoFactor: true,
        message: "Two-factor authentication required",
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

// Setup Microsoft Authenticator MFA
router.post("/mfa/setup", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" })
    }

    // Get user email
    const { data: userData, error: userError } = await supabase
      .from("user_profiles")
      .select("email")
      .eq("user_id", userId)
      .single()

    if (userError) {
      console.error("Error fetching user data:", userError)
      return res.status(500).json({ error: "Failed to fetch user data" })
    }

    const userEmail = userData?.email || "user"

    // Generate secret for TOTP
    const secret = speakeasy.generateSecret({
      name: `Secure Vault Pro (${userEmail})`,
      issuer: "Secure Vault Pro",
      length: 32,
    })

    // Store secret in database (not enabled yet)
    const { error } = await supabase.from("user_mfa").upsert({
      user_id: userId,
      secret: secret.base32,
      is_enabled: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

    if (error) throw error

    await auditLogger.log({
      userId,
      action: "mfa_setup_start",
      resource: "/auth/mfa/setup",
      ipAddress: req.clientIP || req.ip,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({
      success: true,
      secret: secret.base32,
      qrCode: secret.otpauth_url,
    })
  } catch (error) {
    console.error("MFA setup error:", error)
    res.status(500).json({ error: "Failed to setup MFA" })
  }
})

// Verify MFA setup
router.post("/mfa/verify", authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.body.userId

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" })
    }

    const { token } = req.body

    // Get user's MFA secret
    const { data: mfaData, error } = await supabase
      .from("user_mfa")
      .select("secret")
      .eq("user_id", userId)
      .eq("is_enabled", false)
      .single()

    if (error || !mfaData) {
      return res.status(400).json({ error: "MFA not setup for this user" })
    }

    // Verify TOTP token
    const verified = speakeasy.totp.verify({
      secret: mfaData.secret,
      encoding: "base32",
      token: token,
      window: 2,
    })

    if (!verified) {
      await auditLogger.log({
        userId,
        action: "mfa_verify_failed",
        resource: "/auth/mfa/verify",
        ipAddress: req.clientIP || req.ip,
        userAgent: req.get("User-Agent"),
        success: false,
      })

      return res.status(400).json({ error: "Invalid verification code" })
    }

    // Enable MFA for the user
    await supabase
      .from("user_mfa")
      .update({
        is_enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)

    // Update user profile
    await supabase
      .from("user_profiles")
      .update({
        two_factor_enabled: true,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)

    await auditLogger.log({
      userId,
      action: "mfa_enabled",
      resource: "/auth/mfa/verify",
      ipAddress: req.clientIP || req.ip,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({ success: true, message: "MFA enabled successfully" })
  } catch (error) {
    console.error("MFA verification error:", error)
    res.status(500).json({ error: "Failed to verify MFA" })
  }
})

// Verify MFA during login
router.post("/mfa/login-verify", async (req, res) => {
  try {
    const { userId, code, token } = req.body

    let decodedUserId = userId

    // If token is provided, decode it to get userId
    if (token && !userId) {
      try {
        const tokenData = JSON.parse(atob(token))
        decodedUserId = tokenData.userId
      } catch (e) {
        return res.status(400).json({ error: "Invalid token" })
      }
    }

    if (!decodedUserId) {
      return res.status(400).json({ error: "User ID is required" })
    }

    // Get user's MFA secret
    const { data: mfaData, error } = await supabase
      .from("user_mfa")
      .select("secret")
      .eq("user_id", decodedUserId)
      .eq("is_enabled", true)
      .single()

    if (error || !mfaData) {
      return res.status(400).json({ error: "MFA not enabled for this user" })
    }

    // Verify TOTP token
    const verified = speakeasy.totp.verify({
      secret: mfaData.secret,
      encoding: "base32",
      token: code,
      window: 2,
    })

    if (!verified) {
      await auditLogger.log({
        userId: decodedUserId,
        action: "mfa_login_failed",
        resource: "/auth/mfa/login-verify",
        ipAddress: req.clientIP || req.ip,
        userAgent: req.get("User-Agent"),
        success: false,
      })

      return res.status(400).json({ error: "Invalid verification code" })
    }

    await auditLogger.log({
      userId: decodedUserId,
      action: "mfa_login_success",
      resource: "/auth/mfa/login-verify",
      ipAddress: req.clientIP || req.ip,
      userAgent: req.get("User-Agent"),
      success: true,
    })

    res.json({ success: true, message: "MFA verification successful" })
  } catch (error) {
    console.error("MFA login verification error:", error)
    res.status(500).json({ error: "Failed to verify MFA" })
  }
})

// Send Email OTP
router.post('/mfa/email-send', async (req, res) => {
  const { email } = req.body;
  const { data: user, error: userError } = await supabase
    .from('user_profiles')
    .select('id, email')
    .eq('email', email)
    .single();
  if (userError || !user) return res.status(404).json({ error: 'User not found' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  // Store code in verification_codes table
  await supabase.from('verification_codes').insert({
    user_id: user.id,
    code_hash: codeHash,
    expires_at: expiresAt,
    used: false,
  });

  // Send email (configure your transporter)
  const transporter = nodemailer.createTransport({
    // TODO: Replace with your SMTP config
    host: 'smtp.example.com',
    port: 587,
    secure: false,
    auth: {
      user: 'your@email.com',
      pass: 'yourpassword',
    },
  });
  await transporter.sendMail({
    from: 'no-reply@yourapp.com',
    to: user.email,
    subject: 'Your Secure Vault OTP Code',
    text: `Your OTP code is: ${code}`,
  });

  res.json({ success: true });
});

// Verify Email OTP
router.post('/mfa/email-verify', async (req, res) => {
  const { userId, code } = req.body;
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const { data: record, error: codeError } = await supabase
    .from('verification_codes')
    .select('*')
    .eq('user_id', userId)
    .eq('code_hash', codeHash)
    .eq('used', false)
    .gte('expires_at', new Date().toISOString())
    .single();

  if (codeError || !record) return res.status(400).json({ error: 'Invalid or expired code' });

  // Mark as used
  await supabase.from('verification_codes').update({ used: true }).eq('id', record.id);

  res.json({ success: true });
});

// Enable Email OTP MFA
router.post('/mfa/setup-email', async (req, res) => {
  const { userId } = req.body;
  const { error } = await supabase
    .from('user_profiles')
    .update({ mfa_method: 'email' })
    .eq('id', userId);
  if (error) return res.status(500).json({ error: 'Failed to enable email MFA' });
  res.json({ success: true });
});

// Send SMS OTP
router.post('/mfa/sms-send', async (req, res) => {
  const { userId } = req.body;
  const { data: user, error: userError } = await supabase
    .from('user_profiles')
    .select('phone')
    .eq('id', userId)
    .single();
  if (userError || !user || !user.phone) return res.status(400).json({ error: 'No phone number on file' });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  await supabase.from('verification_codes').insert({
    user_id: userId,
    code_hash: codeHash,
    expires_at: expiresAt,
    used: false,
  });

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  await client.messages.create({
    body: `Your Secure Vault OTP code is: ${code}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: user.phone,
  });

  res.json({ success: true });
});

// Verify SMS OTP
router.post('/mfa/sms-verify', async (req, res) => {
  const { userId, code } = req.body;
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const { data: record, error: codeError } = await supabase
    .from('verification_codes')
    .select('*')
    .eq('user_id', userId)
    .eq('code_hash', codeHash)
    .eq('used', false)
    .gte('expires_at', new Date().toISOString())
    .single();

  if (codeError || !record) return res.status(400).json({ error: 'Invalid or expired code' });

  await supabase.from('verification_codes').update({ used: true }).eq('id', record.id);

  res.json({ success: true });
});

module.exports = router
