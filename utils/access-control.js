const geoip = require("geoip-lite")
const { createClient } = require("@supabase/supabase-js")

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

class AccessControl {
  async checkAccess(file, request) {
    try {
      // Get user's access control rules
      const { data: rules } = await supabase
        .from("access_control_rules")
        .select("*")
        .eq("user_id", file.user_id)
        .eq("enabled", true)

      // Check file-specific access control
      if (file.access_control) {
        const fileAccessResult = await this.checkFileAccessControl(file.access_control, request)
        if (!fileAccessResult.allowed) {
          return fileAccessResult
        }
      }

      // Check global access control rules
      for (const rule of rules || []) {
        const ruleResult = await this.checkRule(rule, request)
        if (!ruleResult.allowed) {
          return ruleResult
        }
      }

      return { allowed: true }
    } catch (error) {
      console.error("Access control error:", error)
      return { allowed: false, reason: "Access control system error" }
    }
  }

  async checkFileAccessControl(accessControl, request) {
    // Check time restrictions
    if (accessControl.timeRestriction) {
      const now = new Date()
      const currentTime = now.getHours() * 60 + now.getMinutes()

      const startTime = this.parseTime(accessControl.startTime)
      const endTime = this.parseTime(accessControl.endTime)

      if (currentTime < startTime || currentTime > endTime) {
        return {
          allowed: false,
          reason: `File access is restricted to ${accessControl.startTime} - ${accessControl.endTime}`,
        }
      }
    }

    // Check location restrictions
    if (accessControl.locationRestriction && accessControl.allowedCountries) {
      const geo = geoip.lookup(request.clientIP)
      if (!geo || !accessControl.allowedCountries.includes(geo.country)) {
        return {
          allowed: false,
          reason: "File access is restricted from your location",
        }
      }
    }

    // Check expiration
    if (accessControl.expirationDate) {
      const expirationDate = new Date(accessControl.expirationDate)
      if (new Date() > expirationDate) {
        return {
          allowed: false,
          reason: "File access has expired",
        }
      }
    }

    return { allowed: true }
  }

  async checkRule(rule, request) {
    switch (rule.type) {
      case "time":
        return this.checkTimeRule(rule.config, request)
      case "location":
        return this.checkLocationRule(rule.config, request)
      case "device":
        return this.checkDeviceRule(rule.config, request)
      default:
        return { allowed: true }
    }
  }

  checkTimeRule(config, request) {
    const now = new Date()
    const currentTime = now.getHours() * 60 + now.getMinutes()

    const startTime = this.parseTime(config.startTime)
    const endTime = this.parseTime(config.endTime)

    if (currentTime < startTime || currentTime > endTime) {
      return {
        allowed: false,
        reason: `Access is restricted to ${config.startTime} - ${config.endTime}`,
      }
    }

    return { allowed: true }
  }

  checkLocationRule(config, request) {
    const geo = geoip.lookup(request.clientIP)

    if (!geo) {
      return { allowed: false, reason: "Unable to determine location" }
    }

    if (config.countries && !config.countries.includes(geo.country)) {
      return {
        allowed: false,
        reason: `Access is restricted from ${geo.country}`,
      }
    }

    return { allowed: true }
  }

  async checkDeviceRule(config, request) {
    // Check if device is authorized
    const { data: device } = await supabase
      .from("user_devices")
      .select("*")
      .eq("device_fingerprint", request.deviceFingerprint)
      .eq("authorized", true)
      .single()

    if (!device) {
      return {
        allowed: false,
        reason: "Device is not authorized for access",
      }
    }

    return { allowed: true }
  }

  parseTime(timeString) {
    const [hours, minutes] = timeString.split(":").map(Number)
    return hours * 60 + minutes
  }

  async enforceAccessControl(userId, action, resource, request) {
    const startTime = Date.now()

    try {
      // This should complete within 500ms as per requirements
      const result = await this.checkAccess({ user_id: userId }, request)

      const duration = Date.now() - startTime
      if (duration > 500) {
        console.warn(`Access control check took ${duration}ms (exceeds 500ms requirement)`)
      }

      return result
    } catch (error) {
      console.error("Access control enforcement error:", error)
      return { allowed: false, reason: "Access control system error" }
    }
  }
}

module.exports = new AccessControl()
