import crypto from 'crypto'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

// Configure environment variables first
dotenv.config()

// Debug logging
console.log('Environment variables loaded:')
console.log('SUPABASE_URL:', process.env.SUPABASE_URL)
console.log('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Present' : 'Missing')

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Now import other modules that might use environment variables
import { createClient } from '@supabase/supabase-js'
import compression from 'compression'
import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import morgan from 'morgan'

// Initialize Supabase client
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing required environment variables:')
  console.error('SUPABASE_URL:', process.env.SUPABASE_URL ? 'Present' : 'Missing')
  console.error('SUPABASE_SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'Present' : 'Missing')
  process.exit(1)
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Test database connection
const testConnection = async () => {
  try {
    const { data, error } = await supabase.from('files').select('*').limit(1);
    if (error) throw error;
    console.log('✅ Database connection successful');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
};

// Run connection test
testConnection();

// Verify database connection and schema
(async () => {
  try {
    // Test the connection with a simple query
    const { data, error } = await supabase
      .from('files')
      .select('id')
      .limit(1);

    if (error) {
      console.error('Database connection test failed:', error);
    } else {
      console.log('Database connection successful');
    }

    // Check if encryption columns exist
    const { data: columns, error: columnsError } = await supabase.rpc('get_table_columns', {
      p_table_name: 'files'
    });

    if (columnsError) {
      console.warn('Could not check table columns:', columnsError);
    } else {
      const hasEncryptionColumns = columns.some(col => 
        ['encryption_metadata', 'encryption_key', 'file_hash'].includes(col.column_name)
      );
      
      if (!hasEncryptionColumns) {
        console.warn('Encryption columns not found in files table. Please run the migration script.');
      } else {
        console.log('Encryption columns verified');
      }
    }
  } catch (error) {
    console.error('Database initialization error:', error);
  }
})();

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

// Rate limiting (development: high limit)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // allow 1000 requests per windowMs for development
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

// CORS configuration (development: allow localhost:3000)
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
app.use(express.json({ limit: "50mb" }))
app.use(express.urlencoded({ extended: true, limit: "50mb" }))

// Security middleware
app.use((req, res, next) => {
  req.clientIP = req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || req.connection.remoteAddress || req.ip
  req.requestId = Math.random().toString(36).substr(2, 9)
  req.deviceFingerprint = req.headers["user-agent"] ? 
    crypto.createHash('sha256').update(req.headers["user-agent"]).digest('hex') : 
    "unknown-device"

  // Add CORS headers for file downloads
  res.header('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type, Content-Length');
  
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

// Import routes
import authRoutes from './routes/auth.js'
import fileRoutes from './routes/files.js'
import statsRoutes from './routes/stats.js'
import userRoutes from './routes/users.js'

// Mount routes
app.use("/api/auth", authRoutes);
app.use("/api/files", authMiddleware, fileRoutes);
app.use("/api/users", authMiddleware, userRoutes);
app.use("/api", authMiddleware, statsRoutes);

// Remove or comment out the inline /api/stats endpoint to avoid conflicts
// app.get("/api/stats", authMiddleware, async (req, res) => { ... });

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

export default app
