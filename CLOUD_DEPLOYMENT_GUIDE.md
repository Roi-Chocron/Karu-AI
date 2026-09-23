# מדריך פריסת Karu AI בענן (Web Edition) ☁️

מדריך זה מפרט צעד-אחר-צעד כיצד לפרוס ולהריץ את מערכת הווב של Karu AI בענן.

---

## אפשרות 1: פריסה ב-Cloudflare (Serverless Edge) — מומלץ ביותר! 🌟

ארכיטקטורה זו מריצה את ה-Frontend, ה-Backend, מסד הנתונים, אחסון המדיה ומודלי ה-AI ישירות ברשת העולמית של Cloudflare ללא שרת ייעודי ובחיסכון כספי מוחלט.

### דרישות מקדימות:
1. חשבון פעיל ב-[Cloudflare](https://dash.cloudflare.com/).
2. Node.js גרסה 18 ומעלה מותקנת במחשב שלך.

### שלבי הפריסה:

#### שלב 1: התקנת תלויות וכניסה לחשבון
```bash
cd cloudflare-serverless
npm install
npx wrangler login
```

#### שלב 2: יצירת מסד נתונים D1 (Cloudflare D1 Database)
הרץ את הפקודה ליצירת מסד הנתונים:
```bash
npx wrangler d1 create karu-backend-db
```
בפלט הפקודה תקבל `database_id` (לדוגמה: `76ad95bf-3097-4caf-a4f7-9d3c1568dd39`).
ודא שמזהה זה מעודכן בקובץ `wrangler.jsonc` תחת `d1_databases`.

#### שלב 3: הפעלת הסכמה והאתחול (Schema & Seed)
הפעל את הסכמה בענן:
```bash
npx wrangler d1 execute karu-backend-db --remote --file=schema.sql
```
הפעל את נתוני האתחול (משתמש מנהל ראשוני ופרומפט מובנה):
```bash
npx wrangler d1 execute karu-backend-db --remote --file=seed.sql
```

#### שלב 4: יצירת מרחב אחסון לתמונות (KV Namespace)
צור את מרחב ה-KV עבור העלאות מדיה:
```bash
npx wrangler kv:namespace create KARU_MEDIA
```
עדכן את ה-`id` שהתקבל בקובץ `wrangler.jsonc` תחת `kv_namespaces`.

#### שלב 5: פריסה לאוויר (Deploy)
```bash
npx wrangler deploy
```
בסיום תקבל כתובת URL עולמית פעילה (למשל `https://karu-cloudflare-backend.yourname.workers.dev`), והאתר כולו יהיה זמין מיידית לשימוש ברשת!

---

## אפשרות 2: פריסה באמצעות Docker (VPS, Railway, Render, Fly.io) 🐳

אם ברצונך להריץ שרת Node.js עצמאי בקונטיינר עם דוקר:

### שלבי הפריסה:

#### שלב 1: הגדרת משתני סביבה
היכנס לתיקייה `docker-container`:
```bash
cd docker-container
cp .env.example .env
```
ערוך את קובץ `.env` והגדר:
- `JWT_SECRET`: מפתח סודי אקראי וחזק
- מפתחות Polar.sh ו-Meta לפי הצורך

#### שלב 2: בנייה והרצה ב-Docker Compose
```bash
docker compose up -d --build
```
השרת ייבנה, יתקין את כל התלויות כולל Playwright, יפתח את פורט `3000`, ויחבר שני כרכי אחסון מתמידים (`karu_data` ו-`karu_uploads`).

#### שלב 3: בדיקת תקינות
פתח בדפדפן:
```text
http://YOUR_SERVER_IP:3000
```
או בדוק את ה-API:
```bash
curl http://localhost:3000/api/health
```

#### שלב 4: חיבור דומיין ותעודת SSL (מומלץ בשרת ייצור)
בשרת VPS (כגון Ubuntu / Debian) מומלץ להפעיל שרת הפוך (Nginx או Caddy) עם HTTPS:
```nginx
server {
    server_name app.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
