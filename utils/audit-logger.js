import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Configure environment variables
dotenv.config();

// Initialize Supabase client with environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing required environment variables for audit logger:');
  console.error('SUPABASE_URL:', supabaseUrl ? 'Present' : 'Missing');
  console.error('SUPABASE_SERVICE_ROLE_KEY:', supabaseKey ? 'Present' : 'Missing');
  throw new Error('Missing required environment variables for audit logger');
}

const supabase = createClient(supabaseUrl, supabaseKey);

class AuditLogger {
  async log(entry) {
    try {
      const logEntry = {
        user_id: entry.userId,
        action: entry.action,
        resource: entry.resource,
        ip_address: entry.ipAddress,
        user_agent: entry.userAgent,
        location: entry.location,
        success: entry.success,
        details: entry.details,
        created_at: new Date().toISOString(),
      };

      const { error } = await supabase.from("audit_logs").insert(logEntry);

      if (error) {
        console.error("Audit log error:", error);
      }
    } catch (error) {
      console.error("Audit logger error:", error);
    }
  }

  async getRecentActivity(userId, limit = 10) {
    try {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("Failed to get recent activity:", error);
      return [];
    }
  }

  async getSecurityEvents(userId, timeframe = "24h") {
    try {
      const now = new Date();
      let startTime;

      switch (timeframe) {
        case "1h":
          startTime = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case "24h":
          startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case "7d":
          startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        default:
          startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      }

      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("user_id", userId)
        .gte("created_at", startTime.toISOString())
        .in("action", ["login", "auth_failed", "mfa_failed", "password_change"])
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error("Failed to get security events:", error);
      return [];
    }
  }
}

export const auditLogger = new AuditLogger();
