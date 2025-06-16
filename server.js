const express = require("express")
const cors = require("cors")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
const compression = require("compression")
const morgan = require("morgan")
const path = require("path")
const fs = require("fs").promises
const { createClient } = require("@supabase/supabase-js")
require("dotenv").config()

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const app = express()
const PORT = process.env.PORT || 5000

// Make supabase available to all routes
app.locals.supabase = supabase

// Enhanced logging
app.use(morgan("combined"))

// Security middleware
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  }),
)

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
  standardHeaders: true,
  legacyHeaders: false,
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 auth requests per windowMs
  message: "Too many authentication attempts, please try again later.",
  skipSuccessfulRequests: true,
})

app.use("/api/auth", authLimiter)
app.use("/api", limiter)

// CORS configuration
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
)

// Compression and logging
app.use(compression())

// Body parsing
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true, limit: "10mb" }))

// Security middleware
app.use((req, res, next) => {
  req.clientIP = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.connection.remoteAddress || req.ip
  req.requestId = Math.random().toString(36).substr(2, 9)
  req.deviceFingerprint = req.headers["user-agent"] ? 
    require('crypto').createHash('sha256').update(req.headers["user-agent"]).digest('hex') : 
    "unknown-device"

  console.log(`[${req.requestId}] ${req.method} ${req.path} from ${req.clientIP}`)
  next()
})

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    version: "2.0.0",
    features: [
      "AES-256 encryption",
      "Dynamic access control",
      "Two-factor authentication",
      "Audit logging",
      "Session management",
      "Supabase integration",
    ],
  })
})

// Auth middleware using Supabase
const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No valid authorization token provided" })
    }

    const token = authHeader.substring(7)

    // Verify JWT token with Supabase
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token)

    if (error || !user) {
      console.error(`[${req.requestId}] Auth error:`, error)
      return res.status(401).json({ error: "Invalid or expired token" })
    }

    // Check if user is active
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("user_id", user.id)
      .single()

    if (profile && !profile.active) {
      return res.status(403).json({ error: "Account is deactivated" })
    }

    // Add user to request object
    req.user = user
    req.userProfile = profile

    // Log successful authentication
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "auth_success",
      resource: req.path,
      ip_address: req.clientIP,
      user_agent: req.get("User-Agent"),
      success: true,
      created_at: new Date().toISOString()
    })

    next()
  } catch (error) {
    console.error(`[${req.requestId}] Auth middleware error:`, error)
    res.status(500).json({ error: "Authentication service error" })
  }
}

// Routes
app.use("/api/auth", require("./routes/auth"))
app.use("/api/files", authMiddleware, require("./routes/files"))
app.use("/api/stats", authMiddleware, require("./routes/stats"))
app.use("/api/access-control", authMiddleware, require("./routes/access-control"))
app.use("/api/audit", authMiddleware, require("./routes/audit"))
app.use("/api/user", authMiddleware, require("./routes/user"))
app.use("/api/mfa", authMiddleware, require("./routes/mfa"))

// Enhanced error handling
app.use((err, req, res, next) => {
  console.error(`[${req.requestId}] Error:`, err)
  console.error(`[${req.requestId}] Stack:`, err.stack)

  let statusCode = 500
  let message = "Internal server error"

  // Handle specific error types
  if (err.name === "ValidationError") {
    statusCode = 400
    message = "Validation error"
  } else if (err.name === "UnauthorizedError") {
    statusCode = 401
    message = "Unauthorized"
  } else if (err.name === "ForbiddenError") {
    statusCode = 403
    message = "Forbidden"
  } else if (err.name === "NotFoundError") {
    statusCode = 404
    message = "Not found"
  } else if (err.code === "LIMIT_FILE_SIZE") {
    statusCode = 413
    message = "File too large"
  }

  // Send error response
  res.status(statusCode).json({
    error: message,
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
    details: process.env.NODE_ENV === "development" ? err.message : undefined,
  })
})

// 404 handler
app.use("*", (req, res) => {
  console.log(`[${req.requestId}] 404: ${req.method} ${req.originalUrl}`)
  res.status(404).json({ error: "Endpoint not found" })
})

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully")
  process.exit(0)
})

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully")
  process.exit(0)
})

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Secure Vault Pro API running on port ${PORT}`)
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`)
  console.log(`🔒 Security features: Encryption, 2FA, Access Control, Audit Logging, Supabase Storage`)
  console.log(`🔌 Connected to Supabase: ${process.env.SUPABASE_URL ? "Yes" : "No"}`)
})

module.exports = app
