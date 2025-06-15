import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { auditLogger } from '../utils/audit-logger.js';

// Configure environment variables
dotenv.config();

// Initialize Supabase client with environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing required environment variables for auth middleware:');
  console.error('SUPABASE_URL:', supabaseUrl ? 'Present' : 'Missing');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', supabaseKey ? 'Present' : 'Missing');
  throw new Error('Missing required environment variables for auth middleware');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No valid authorization token provided" });
    }

    const token = authHeader.substring(7);

    // Verify JWT token with Supabase
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser(token);

    if (error || !user) {
      await auditLogger.log({
        userId: null,
        action: "auth_failed",
        resource: req.path,
        ipAddress: req.ip,
        userAgent: req.get("User-Agent"),
        success: false,
        details: { error: "Invalid token" },
      });

      return res.status(401).json({ error: "Invalid or expired token" });
    }

    // Check if user is active
    const { data: profile } = await supabase.from("user_profiles").select("*").eq("user_id", user.id).single();

    if (profile && !profile.active) {
      return res.status(403).json({ error: "Account is deactivated" });
    }

    // Add user to request object
    req.user = user;
    req.userProfile = profile;

    // Log successful authentication
    await auditLogger.log({
      userId: user.id,
      action: "auth_success",
      resource: req.path,
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      success: true,
    });

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);

    await auditLogger.log({
      userId: null,
      action: "auth_error",
      resource: req.path,
      ipAddress: req.ip,
      userAgent: req.get("User-Agent"),
      success: false,
      details: { error: error.message },
    });

    res.status(500).json({ error: "Authentication service error" });
  }
};
