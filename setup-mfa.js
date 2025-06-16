const fs = require("fs")
const path = require("path")
const crypto = require("crypto")

console.log("🔧 Setting up Microsoft Authenticator MFA for Secure Vault Pro...")

// Create .env file if it doesn't exist
const envPath = path.join(__dirname, ".env")
if (!fs.existsSync(envPath)) {
  console.log("📝 Creating .env file...")
  
  const envContent = `# Supabase Configuration
SUPABASE_URL=https://eehpwimimrpzszacgxko.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVlaHB3aW1pbXJwenN6YWNneGtvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0ODQwNzY0OSwiZXhwIjoyMDYzOTgzNjQ5fQ.ufRM9WJZLL2l8UW0FxsquADhVZvQBeTJBmpX1TtT398

# Server Configuration
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Security Keys (Generated automatically)
JWT_SECRET=${crypto.randomBytes(32).toString('hex')}
ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
AUTH_RATE_LIMIT_MAX=5

# Optional: Twilio Configuration (for SMS 2FA)
# TWILIO_ACCOUNT_SID=your_twilio_account_sid
# TWILIO_AUTH_TOKEN=your_twilio_auth_token
# TWILIO_PHONE_NUMBER=your_twilio_phone_number
`

  fs.writeFileSync(envPath, envContent)
  console.log("✅ .env file created successfully")
} else {
  console.log("✅ .env file already exists")
}

// Check if database table exists
console.log("\n🗄️  Database Setup:")
console.log("1. Run the following SQL in your Supabase SQL editor:")
console.log("   (Copy the contents of database/user_mfa_table.sql)")

// Check dependencies
console.log("\n📦 Checking dependencies...")
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8"))
const requiredDeps = ["speakeasy", "qrcode", "bcryptjs", "@supabase/supabase-js"]

const missingDeps = requiredDeps.filter(dep => !packageJson.dependencies[dep] && !packageJson.devDependencies[dep])

if (missingDeps.length > 0) {
  console.log(`❌ Missing dependencies: ${missingDeps.join(", ")}`)
  console.log("Run: npm install " + missingDeps.join(" "))
} else {
  console.log("✅ All required dependencies are installed")
}

console.log("\n🚀 Setup complete!")
console.log("\nNext steps:")
console.log("1. Start the backend: npm run dev")
console.log("2. Start the frontend: cd ../Secure-Vault-Frontend && npm run dev")
console.log("3. Open http://localhost:3000 in your browser")
console.log("4. Sign up/login and enable Microsoft Authenticator in your profile")
console.log("\n📱 Microsoft Authenticator Setup:")
console.log("1. Download Microsoft Authenticator from your app store")
console.log("2. Go to your profile settings in the app")
console.log("3. Click 'Enable Two-Factor Authentication'")
console.log("4. Scan the QR code or enter the secret manually")
console.log("5. Enter the 6-digit code to complete setup") 