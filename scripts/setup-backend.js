const fs = require("fs")
const path = require("path")

// Create backend directory structure
const backendDir = "../secure-vault-backend"
const dirs = [
  backendDir,
  `${backendDir}/routes`,
  `${backendDir}/middleware`,
  `${backendDir}/utils`,
  `${backendDir}/uploads`,
]

dirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    console.log(`Created directory: ${dir}`)
  }
})

// Create backend package.json
const backendPackageJson = {
  name: "secure-vault-backend",
  version: "2.0.0",
  description: "Secure file storage backend with advanced security features",
  main: "server.js",
  scripts: {
    start: "node server.js",
    dev: "nodemon server.js",
    test: "jest",
  },
  dependencies: {
    express: "^4.18.2",
    cors: "^2.8.5",
    helmet: "^7.1.0",
    "express-rate-limit": "^7.1.5",
    compression: "^1.7.4",
    morgan: "^1.10.0",
    multer: "^1.4.5-lts.1",
    bcryptjs: "^2.4.3",
    "geoip-lite": "^1.4.10",
    twilio: "^4.19.0",
    "@supabase/supabase-js": "^2.38.4",
    dotenv: "^16.3.1",
  },
  devDependencies: {
    nodemon: "^3.0.2",
    jest: "^29.7.0",
  },
  keywords: ["file-storage", "security", "encryption", "access-control"],
  author: "Your Name",
  license: "MIT",
}

fs.writeFileSync(`${backendDir}/package.json`, JSON.stringify(backendPackageJson, null, 2))
console.log("Created backend package.json")

// Create backend .env.example
const backendEnvExample = `# Supabase Configuration
SUPABASE_URL=your_supabase_project_url
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Server Configuration
PORT=5000
NODE_ENV=development
FRONTEND_URL=http://localhost:3000

# Twilio Configuration (for 2FA SMS)
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number

# Security
JWT_SECRET=your_jwt_secret_key_here_make_it_long_and_random
ENCRYPTION_KEY=your_32_byte_encryption_key_here_also_random

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
AUTH_RATE_LIMIT_MAX=5`

fs.writeFileSync(`${backendDir}/.env.example`, backendEnvExample)
console.log("Created backend .env.example")

// Create uploads .gitkeep
fs.writeFileSync(
  `${backendDir}/uploads/.gitkeep`,
  "# This file ensures the uploads directory is tracked by git\n# The directory is needed for temporary file storage during uploads",
)

console.log("\nBackend setup complete!")
console.log("\nNext steps:")
console.log("1. cd ../secure-vault-backend")
console.log("2. npm install")
console.log("3. cp .env.example .env")
console.log("4. Edit .env with your actual values")
console.log("5. npm run dev")
