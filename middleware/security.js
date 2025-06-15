const dotenv = require('dotenv');
const crypto = require("crypto")
const geoip = require("geoip-lite")
const { createClient } = require("@supabase/supabase-js")

// Configure environment variables
dotenv.config();

// Initialize Supabase client with environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing required environment variables for security middleware:');
  console.error('SUPABASE_URL:', supabaseUrl ? 'Present' : 'Missing');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', supabaseKey ? 'Present' : 'Missing');
  throw new Error('Missing required environment variables for security middleware');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const securityMiddleware = async (req, res, next) => {
  try {
    // Generate request ID for tracking
    req.requestId = crypto.randomUUID()

    // Get client IP (handle proxy headers)
    const clientIP =
      req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.connection.remoteAddress || req.ip

    req.clientIP = clientIP

    // Get geolocation info
    const geo = geoip.lookup(clientIP)
    req.location = geo
      ? {
          country: geo.country,
          region: geo.region,
          city: geo.city,
          timezone: geo.timezone,
        }
      : null

    // Generate device fingerprint
    const userAgent = req.get("User-Agent") || ""
    const acceptLanguage = req.get("Accept-Language") || ""
    const acceptEncoding = req.get("Accept-Encoding") || ""

    const deviceFingerprint = crypto
      .createHash("sha256")
      .update(userAgent + acceptLanguage + acceptEncoding + clientIP)
      .digest("hex")

    req.deviceFingerprint = deviceFingerprint

    // Security headers
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Request-ID": req.requestId,
    })

    next()
  } catch (error) {
    console.error("Security middleware error:", error)
    next()
  }
}

module.exports = securityMiddleware
