const express = require("express")
const cors = require("cors")
const helmet = require("helmet")
const rateLimit = require("express-rate-limit")
const compression = require("compression")
const morgan = require("morgan")
const path = require("path")
const fs = require("fs").promises
require("dotenv").config()

const authMiddleware = require("./middleware/auth")
const errorHandler = require("./middleware/error-handler")
const securityMiddleware = require("./middleware/security")

// Route imports
const authRoutes = require("./routes/auth")
const filesRoutes = require("./routes/files")
const statsRoutes = require("./routes/stats")
const accessControlRoutes = require("./routes/access-control")
const auditRoutes = require("./routes/audit")
const userRoutes = require("./routes/user")

const app = express()
const PORT = process.env.PORT || 5000

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
app.use(morgan("combined"))

// Body parsing
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true, limit: "10mb" }))

// Security middleware
app.use(securityMiddleware)

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
    ],
  })
})

// API routes
app.use("/api/auth", authRoutes)
app.use("/api/files", authMiddleware, filesRoutes)
app.use("/api/stats", authMiddleware, statsRoutes)
app.use("/api/access-control", authMiddleware, accessControlRoutes)
app.use("/api/audit", authMiddleware, auditRoutes)
app.use("/api/user", authMiddleware, userRoutes)

// Error handling
app.use(errorHandler)

// 404 handler
app.use("*", (req, res) => {
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
  console.log(`🔒 Security features: Encryption, 2FA, Access Control, Audit Logging`)
})

module.exports = app
