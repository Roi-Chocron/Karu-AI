-- Schema for Karu AI Backend on Cloudflare D1

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    subscription TEXT DEFAULT 'free',
    posts_left INTEGER DEFAULT 3,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    instagram_connected INTEGER DEFAULT 0,
    preferred_time TEXT DEFAULT '18:00',
    phone TEXT DEFAULT '',
    bio TEXT DEFAULT '',
    role TEXT DEFAULT 'user',
    polar_customer_id TEXT DEFAULT NULL,
    polar_subscription_id TEXT DEFAULT NULL,
    polar_product_id TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    username TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    hashtags TEXT,
    tokens_prompt INTEGER DEFAULT 0,
    tokens_save INTEGER DEFAULT 0,
    tokens_autopost INTEGER DEFAULT 0,
    carousel_data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    chat_history TEXT,
    likes_count INTEGER DEFAULT 0,
    is_liked INTEGER DEFAULT 0,
    is_shared INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS cloudflare_generations (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    model TEXT NOT NULL,
    image_url TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS polar_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    processed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indices for fast lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts(user_id);
CREATE INDEX IF NOT EXISTS idx_posts_is_shared ON posts(is_shared);

-- Table for tracking full activity logs of all users
CREATE TABLE IF NOT EXISTS user_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    username TEXT,
    action TEXT NOT NULL,
    level TEXT DEFAULT 'INFO',
    message TEXT NOT NULL,
    method TEXT,
    path TEXT,
    status_code INTEGER,
    ip TEXT,
    user_agent TEXT,
    duration_ms INTEGER,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_logs_user_id ON user_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_logs_created_at ON user_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_logs_level ON user_logs(level);
CREATE INDEX IF NOT EXISTS idx_user_logs_action ON user_logs(action);

