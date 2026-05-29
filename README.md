# Finance Collection Management System

## HOW TO RUN

---

### PREREQUISITES
- Node.js v18+
- MySQL 8.0+
- npm

---

### STEP 1: Setup MySQL Database

```sql
-- Run schema.sql in your MySQL client:
mysql -u root -p < schema.sql

-- OR in MySQL shell:
source /path/to/schema.sql;
```

---

### STEP 2: Setup Backend

```bash
cd backend

# Install dependencies
npm install

# Copy env file and fill in your values
cp .env.example .env
```

Edit `.env`:
```
PORT=5000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_MYSQL_PASSWORD
DB_NAME=finance_app
JWT_SECRET=change_this_to_a_long_random_string
APP_ENCRYPTION_KEY=use_a_long_random_secret_for_amount_encryption
JWT_EXPIRES_IN=12h
BCRYPT_ROUNDS=10
FRONTEND_URL=http://localhost:3000
```

```bash
# Start backend
npm start

# OR dev mode with auto-reload
npm run dev
```

Backend runs at: http://localhost:5000
Test: http://localhost:5000/health

---

### STEP 3: Setup Frontend

```bash
cd frontend

# Install dependencies
npm install

# Copy env file
cp .env.example .env
```

Edit `.env`:
```
REACT_APP_API_URL=http://localhost:5000/api
```

```bash
# Start frontend
npm start
```

Frontend runs at: http://localhost:3000

---

### STEP 4: First Login

Default admin credentials:
- Username: `admin`
- Password: `admin123`

**IMPORTANT:** Change admin password immediately after first login!
Go to Agents tab → find admin → change password.

---

### FINANCIAL DATA PROTECTION

Amount fields are stored encrypted at rest in the database.

For a fresh setup:
- run the updated `schema.sql`
- set `APP_ENCRYPTION_KEY` in `backend/.env`

For an existing database:
- apply `backend/migrations/001_encrypt_financial_amounts.sql`
- run `npm run backfill:amounts` inside `backend`
- after verifying the app, remove the old plaintext amount columns from MySQL

---

### STEP 5: Daily Workflow

1. **Admin logs in** → clicks "Start Day"
2. **Agents log in** → collect money → entries auto-sync when online
3. **Admin reviews** duplicates tab before closing
4. **Admin clicks "Close Day"** → all entries locked
5. **Admin downloads Excel** from Dashboard or Report tab

---

### DEPLOYMENT (Production)

#### Backend → Render.com
```bash
# In Render: create Web Service
# Connect your GitHub repo (backend folder)
# Set env vars in Render dashboard
# Build command: npm install
# Start command: npm start
```

#### Frontend → Vercel
```bash
npm install -g vercel
cd frontend
vercel

# Set env var in Vercel dashboard:
# REACT_APP_API_URL = https://your-backend.onrender.com/api
```

#### Database → Aiven (MySQL)
1. Create MySQL service on Aiven
2. Copy connection details to backend .env
3. Run schema.sql via Aiven console

---

### RESET ADMIN PASSWORD (if locked out)

```sql
-- Replace 'newpassword' with actual password
-- First generate hash: node -e "const b=require('bcrypt'); b.hash('newpassword',10).then(console.log)"
UPDATE users SET password_hash = 'PASTE_HASH_HERE' WHERE username = 'admin';
```

---

### PROJECT STRUCTURE

```
finance-app/
├── schema.sql              ← Run this first in MySQL
├── backend/
│   ├── server.js           ← Main entry point
│   ├── .env.example        ← Copy to .env
│   ├── routes/
│   │   ├── auth.js         ← Login
│   │   ├── sessions.js     ← Start/Close day
│   │   ├── customers.js    ← Customer + accounts CRUD
│   │   ├── transactions.js ← Sync, duplicate detection
│   │   ├── users.js        ← Agent management
│   │   └── export.js       ← Excel download
│   ├── middleware/
│   │   └── auth.js         ← JWT middleware
│   └── utils/
│       └── db.js           ← MySQL pool
└── frontend/
    ├── src/
    │   ├── App.js
    │   ├── pages/
    │   │   ├── LoginPage.js
    │   │   ├── AgentDashboard.js   ← Collection entry + offline
    │   │   └── AdminDashboard.js   ← Full admin with 5 tabs
    │   ├── hooks/
    │   │   └── useSync.js          ← Online/offline sync logic
    │   └── utils/
    │       ├── api.js              ← All API calls
    │       ├── offlineStore.js     ← IndexedDB wrapper
    │       └── AuthContext.js      ← Auth state
    └── .env.example
```
